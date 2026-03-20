import { BrowserView, BrowserWindow, BuildConfig, GlobalShortcut, PATHS } from 'electrobun/bun';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { native, toCString } from '../../node_modules/electrobun/dist-linux-x64/api/bun/proc/native';

import {
  DESKTOP_KEYBOARD_ACTIONS,
  type DesktopKeyboardAction,
  type DesktopKeyboardConfig,
  getDefaultDesktopKeyboardConfig,
  keybindToAccelerator,
  keybindToAccelerators,
  resolveDesktopKeyboardConfig,
} from '../shared/keyboard';
import type { DesktopZoomAction } from '../shared/desktopRpcSchema';
import { createDesktopRpc } from './desktopRpc';
import { createPerfTraceRecorder } from './perfTrace';
import { getAppStateValue, openDesktopDatabase, setAppStateValue } from './storage';

const DEFAULT_DESKTOP_RENDERER_URL = 'http://localhost:2050';

process.title = 'Verde';

const readInitialProjectRootFromEnv = (): string => {
  const value = process.env.EDITORTS_DESKTOP_PROJECT_ROOT?.trim() ?? '';
  if (value.length === 0) {
    return '';
  }
  return path.resolve(value);
};

const parseInitialProjectRoot = (argv: string[]): string => {
  const fromEnv = readInitialProjectRootFromEnv();
  if (fromEnv.length > 0) {
    return fromEnv;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '-p' || arg === '--project') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        continue;
      }
      return path.resolve(process.cwd(), next);
    }

    if (arg.startsWith('--project=')) {
      const value = arg.slice('--project='.length).trim();
      if (value.length > 0) {
        return path.resolve(process.cwd(), value);
      }
    }

    if (arg.startsWith('-p=')) {
      const value = arg.slice('-p='.length).trim();
      if (value.length > 0) {
        return path.resolve(process.cwd(), value);
      }
    }
  }

  return '';
};

const buildConfig = await BuildConfig.get();
const bundledRendererEntry = typeof buildConfig.runtime?.desktopRendererEntry === 'string'
  ? buildConfig.runtime.desktopRendererEntry.trim()
  : '';
const usingBundledRenderer = bundledRendererEntry === 'bundled' && !process.env.EDITORTS_DESKTOP_URL;

const viewsRoot = PATHS.VIEWS_FOLDER;

const getContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
};

const resolveBundledAssetPath = (requestPathname: string): string => {
  const normalized = requestPathname === '/' ? '/index.html' : requestPathname;
  const decoded = decodeURIComponent(normalized);
  const relativePath = decoded.replace(/^\/+/, '');
  const absolutePath = path.resolve(viewsRoot, relativePath);
  const relativeFromRoot = path.relative(viewsRoot, absolutePath);

  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    return path.resolve(viewsRoot, 'index.html');
  }

  return absolutePath;
};

const bundledRendererServer = usingBundledRenderer
  ? Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const assetPath = resolveBundledAssetPath(url.pathname);

      try {
        const stat = await fs.stat(assetPath);
        if (stat.isDirectory()) {
          const indexPath = path.join(assetPath, 'index.html');
          return new Response(Bun.file(indexPath), {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
            },
          });
        }

        return new Response(Bun.file(assetPath), {
          headers: {
            'content-type': getContentType(assetPath),
            'cache-control': assetPath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
          },
        });
      } catch {
        const fallbackPath = path.resolve(viewsRoot, 'index.html');
        return new Response(Bun.file(fallbackPath), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }
    },
  })
  : null;

const { db, sqlitePath, userDataPath } = openDesktopDatabase();
const perfTrace = await createPerfTraceRecorder({ userDataPath });

const readStoredPageZoom = (): number | null => {
  const rawValue = getAppStateValue(db, DESKTOP_ZOOM_STORAGE_KEY);
  if (typeof rawValue !== 'string') {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const rendererUrl = (process.env.EDITORTS_DESKTOP_URL
  ?? (usingBundledRenderer && bundledRendererServer
    ? `http://${bundledRendererServer.hostname}:${bundledRendererServer.port}/index.html`
    : DEFAULT_DESKTOP_RENDERER_URL)).trim();
const configuredZoom = Number(process.env.EDITORTS_DESKTOP_ZOOM ?? '');
const storedPageZoom = readStoredPageZoom();
const pageZoom = Number.isFinite(configuredZoom) && configuredZoom > 0
  ? configuredZoom
  : storedPageZoom !== null
    ? storedPageZoom
    : process.platform === 'linux'
      ? 0.8
      : 1;
const DESKTOP_ZOOM_STEP = 0.1;
const DESKTOP_ZOOM_MIN = 0.3;
const DESKTOP_ZOOM_MAX = 3;
const configuredUiScale = Number(process.env.EDITORTS_DESKTOP_UI_SCALE ?? '');
const uiScale = Number.isFinite(configuredUiScale) && configuredUiScale > 0
  ? configuredUiScale
  : process.platform === 'linux'
    ? 0.8
    : 1;
const debugAi = process.env.EDITORTS_AI_DEBUG === '1';
const initialProjectRoot = parseInitialProjectRoot(process.argv.slice(2));
const DESKTOP_RELOAD_DELAY_MS = 140;
const DESKTOP_SHORTCUT_RELOAD_DELAY_MS = 320;
const DESKTOP_ZOOM_DEDUP_MS = 80;
const DESKTOP_ZOOM_STORAGE_KEY = 'pageZoom';
const VERDE_CONFIG_RELATIVE_PATH = path.join('.config', 'verde', 'verde.json');

if (initialProjectRoot.length > 0) {
  console.log('[desktop-startup] initial project root:', initialProjectRoot);
}

const isErrorWithCode = (error: unknown, code: string): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
};

const resolveVerdeConfigPath = (): string => {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome && xdgConfigHome.length > 0) {
    return path.join(xdgConfigHome, 'verde', 'verde.json');
  }

  return path.join(homedir(), VERDE_CONFIG_RELATIVE_PATH);
};

const loadDesktopKeyboardConfig = async (): Promise<DesktopKeyboardConfig> => {
  const configPath = resolveVerdeConfigPath();

  let rawConfig: string;
  try {
    rawConfig = await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) {
      return getDefaultDesktopKeyboardConfig();
    }

    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[desktop-keyboard] failed to read ${configPath}: ${message}`);
    return getDefaultDesktopKeyboardConfig();
  }

  try {
    const parsed = JSON.parse(rawConfig) as unknown;
    const { warnings, ...keyboard } = resolveDesktopKeyboardConfig(parsed);
    for (const warning of warnings) {
      console.warn(`[desktop-keyboard] ${warning}`);
    }
    console.log(`[desktop-keyboard] loaded keybinds from ${configPath}`);
    return keyboard;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[desktop-keyboard] failed to parse ${configPath}: ${message}`);
    return getDefaultDesktopKeyboardConfig();
  }
};

const desktopKeyboard = await loadDesktopKeyboardConfig();

const desktopBoot = {
  runtime: 'electrobun',
  sqlitePath,
  userDataPath,
  rendererUrl,
  uiScale,
  debugAi,
  bundledRenderer: usingBundledRenderer,
  initialProjectRoot: initialProjectRoot || undefined,
  keyboard: desktopKeyboard,
  nativeShortcutsAvailable: !isWaylandDesktop(),
  perf: perfTrace.config,
} as const;

const preloadScript = `
  window.__EDITORTS_DESKTOP__ = ${JSON.stringify(desktopBoot)};
`;

process.on('uncaughtException', (error: Error) => {
  perfTrace.record({
    origin: 'main',
    kind: 'lifecycle',
    name: 'uncaught-exception',
    at: Date.now(),
    monotonicMs: performance.now(),
    fields: {
      message: error.message,
    },
  });
  console.error('[desktop-bun:error] uncaughtException', error.stack ?? error.message);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  perfTrace.record({
    origin: 'main',
    kind: 'lifecycle',
    name: 'unhandled-rejection',
    at: Date.now(),
    monotonicMs: performance.now(),
    fields: {
      message,
    },
  });
  console.error('[desktop-bun:error] unhandledRejection', message);
});

let currentPageZoom = pageZoom;

const clampPageZoom = (value: number): number => {
  return Math.min(DESKTOP_ZOOM_MAX, Math.max(DESKTOP_ZOOM_MIN, value));
};

const applyRendererZoomFallback = (): void => {
  const webview = mainWindow.webview;
  if (!webview) {
    return;
  }

  const script = `(() => {
    const zoom = ${JSON.stringify(currentPageZoom)};
    const applyZoom = (doc) => {
      if (!doc || !doc.documentElement) {
        return;
      }

      doc.documentElement.style.zoom = String(zoom);
    };

    applyZoom(document);
  })()`;

  try {
    webview.executeJavascript(script);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[desktop-shortcuts] renderer zoom fallback failed', message);
  }
};

const applyWindowZoom = (): void => {
  mainWindow.setPageZoom(currentPageZoom);
  applyRendererZoomFallback();
};

const setWindowZoom = (value: number): void => {
  currentPageZoom = clampPageZoom(Number(value.toFixed(2)));
  setAppStateValue(db, DESKTOP_ZOOM_STORAGE_KEY, String(currentPageZoom));
  applyWindowZoom();
};

const increaseWindowZoom = (): void => {
  setWindowZoom(currentPageZoom + DESKTOP_ZOOM_STEP);
};

const decreaseWindowZoom = (): void => {
  setWindowZoom(currentPageZoom - DESKTOP_ZOOM_STEP);
};

const resetWindowZoom = (): void => {
  setWindowZoom(pageZoom);
};

let lastZoomAction: DesktopZoomAction | null = null;
let lastZoomActionAt = 0;

const performZoomAction = (action: DesktopZoomAction): void => {
  const now = Date.now();
  if (lastZoomAction === action && now - lastZoomActionAt < DESKTOP_ZOOM_DEDUP_MS) {
    return;
  }

  lastZoomAction = action;
  lastZoomActionAt = now;

  switch (action) {
    case 'in':
      increaseWindowZoom();
      break;
    case 'out':
      decreaseWindowZoom();
      break;
    case 'reset':
      resetWindowZoom();
      break;
  }
};

let pendingReloadTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleWindowReload = (handler: () => void): void => {
  if (pendingReloadTimer !== null) {
    clearTimeout(pendingReloadTimer);
  }

  pendingReloadTimer = setTimeout(() => {
    pendingReloadTimer = null;
    handler();
  }, DESKTOP_RELOAD_DELAY_MS);
};

const reloadWindow = (): void => {
  const webview = mainWindow.webview;
  if (!webview) {
    return;
  }

  scheduleWindowReload(() => {
    try {
      webview.executeJavascript(`window.setTimeout(() => window.location.reload(), ${DESKTOP_SHORTCUT_RELOAD_DELAY_MS})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[desktop-shortcuts] renderer reload fallback triggered', message);
      webview.loadURL(rendererUrl);
    }
  });
};

const toggleWindowDevTools = (): void => {
  mainWindow.webview?.toggleDevTools();
};

function isWaylandDesktop(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland';
}

const desktopRpc = createDesktopRpc({
  db,
  sqlitePath,
  userDataPath,
  onToggleDevTools: toggleWindowDevTools,
  onAdjustZoom: performZoomAction,
  onSyncCanvasWebview: ({ id, hidden, frame }) => {
    const webview = BrowserView.getById(id);
    if (!webview?.ptr) {
      return;
    }

    const zoomScale = currentPageZoom > 0 ? currentPageZoom : 1;
    const nativeFrame = hidden
      ? { ...frame }
      : {
        x: Math.round(frame.x / zoomScale),
        y: Math.round(frame.y / zoomScale),
        width: Math.max(1, Math.round(frame.width / zoomScale)),
        height: Math.max(1, Math.round(frame.height / zoomScale)),
      };

    webview.frame = nativeFrame;
    webview.setPageZoom(1);
    native.symbols.resizeWebview(
      webview.ptr,
      nativeFrame.x,
      nativeFrame.y,
      nativeFrame.width,
      nativeFrame.height,
      toCString('[]'),
    );
    native.symbols.webviewSetHidden(webview.ptr, hidden);
  },
  onPerfEvent: (event) => {
    perfTrace.record(event);
  },
});

const desktopRenderer = process.platform === 'linux' ? 'cef' : 'system';

const mainWindow = new BrowserWindow({
  title: 'Verde',
  url: rendererUrl,
  renderer: desktopRenderer,
  viewsRoot: null,
  frame: {
    x: 60,
    y: 40,
    width: 1600,
    height: 1040,
  },
  preload: preloadScript,
  rpc: desktopRpc,
});
perfTrace.record({
  origin: 'main',
  kind: 'lifecycle',
  name: 'browser-window-created',
  at: Date.now(),
  monotonicMs: performance.now(),
  fields: {
    rendererUrl,
    bundledRenderer: usingBundledRenderer,
    desktopRenderer,
  },
});

const registerWindowShortcut = (
  accelerator: string,
  action: DesktopKeyboardAction,
  handler: () => void,
): void => {
  console.log('[desktop-shortcuts] registering', accelerator);
  const registered = GlobalShortcut.register(accelerator, () => {
    console.log('[desktop-shortcuts] fired', action, accelerator);
    handler();
  });
  if (!registered) {
    console.warn('[desktop-shortcuts] failed to register', accelerator);
  }
};

const registerConfiguredShortcuts = (keyboard: DesktopKeyboardConfig): void => {
  const handlers: Record<DesktopKeyboardAction, () => void> = {
    refresh: reloadWindow,
    toggleDevTools: toggleWindowDevTools,
    zoomIn: () => performZoomAction('in'),
    zoomOut: () => performZoomAction('out'),
    zoomReset: () => performZoomAction('reset'),
  };
  const seen = new Set<string>();

  for (const action of DESKTOP_KEYBOARD_ACTIONS) {
    for (const binding of keyboard.keybinds[action]) {
      const accelerators = keybindToAccelerators(binding);
      if (accelerators.length === 0) {
        console.warn(`[desktop-shortcuts] invalid keybind ignored: ${binding}`);
        continue;
      }

      for (const accelerator of accelerators) {
        const normalizedAccelerator = accelerator.toLowerCase();
        if (seen.has(normalizedAccelerator)) {
          continue;
        }

        seen.add(normalizedAccelerator);
        registerWindowShortcut(accelerator, action, handlers[action]);
      }
    }
  }
};

applyWindowZoom();
mainWindow.webview?.on('dom-ready', () => {
  perfTrace.record({
    origin: 'main',
    kind: 'lifecycle',
    name: 'webview-dom-ready',
    at: Date.now(),
    monotonicMs: performance.now(),
  });
  applyWindowZoom();
});
mainWindow.webview?.on('did-navigate', () => {
  perfTrace.record({
    origin: 'main',
    kind: 'lifecycle',
    name: 'webview-did-navigate',
    at: Date.now(),
    monotonicMs: performance.now(),
  });
  applyWindowZoom();
});
mainWindow.webview?.on('did-navigate-in-page', () => {
  perfTrace.record({
    origin: 'main',
    kind: 'lifecycle',
    name: 'webview-did-navigate-in-page',
    at: Date.now(),
    monotonicMs: performance.now(),
  });
  applyWindowZoom();
});
if (isWaylandDesktop()) {
  console.log('[desktop-shortcuts] skipping native global shortcuts on Wayland');
} else {
  // registerConfiguredShortcuts(desktopKeyboard);
}

registerConfiguredShortcuts(desktopKeyboard);

process.on('beforeExit', () => {
  void perfTrace.stop();
});

process.on('exit', () => {
  if (pendingReloadTimer !== null) {
    clearTimeout(pendingReloadTimer);
  }
  if (!isWaylandDesktop()) {
    GlobalShortcut.unregisterAll();
  }
  bundledRendererServer?.stop(true);
  db.close();
});
