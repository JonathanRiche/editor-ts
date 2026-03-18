import { BrowserWindow, BuildConfig, GlobalShortcut, PATHS } from 'electrobun/bun';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { createDesktopRpc } from './desktopRpc';
import { openDesktopDatabase } from './storage';

const DEFAULT_DESKTOP_RENDERER_URL = 'http://localhost:2050';

process.title = 'Blink';

const parseInitialProjectRoot = (argv: string[]): string => {
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

const rendererUrl = (process.env.EDITORTS_DESKTOP_URL
  ?? (usingBundledRenderer && bundledRendererServer
    ? `http://${bundledRendererServer.hostname}:${bundledRendererServer.port}/index.html`
    : DEFAULT_DESKTOP_RENDERER_URL)).trim();
const configuredZoom = Number(process.env.EDITORTS_DESKTOP_ZOOM ?? '');
const pageZoom = Number.isFinite(configuredZoom) && configuredZoom > 0
  ? configuredZoom
  : process.platform === 'linux'
    ? 0.8
    : 1;
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

const desktopBoot = {
  runtime: 'electrobun',
  sqlitePath,
  userDataPath,
  rendererUrl,
  uiScale,
  debugAi,
  bundledRenderer: usingBundledRenderer,
  initialProjectRoot: initialProjectRoot || undefined,
} as const;

const preloadScript = `
  window.__EDITORTS_DESKTOP__ = ${JSON.stringify(desktopBoot)};
`;

const mainWindow = new BrowserWindow({
  title: 'EditorTs Desktop',
  url: rendererUrl,
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

process.on('uncaughtException', (error: Error) => {
  console.error('[desktop-bun:error] uncaughtException', error.stack ?? error.message);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  console.error('[desktop-bun:error] unhandledRejection', message);
});

const applyWindowZoom = (): void => {
  mainWindow.setPageZoom(pageZoom);
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

const isWaylandDesktop = (): boolean => {
  if (process.platform !== 'linux') {
    return false;
  }

  return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland';
};

const desktopRpc = createDesktopRpc({
  db,
  sqlitePath,
  userDataPath,
  onToggleDevTools: toggleWindowDevTools,
});

const registerWindowShortcut = (accelerator: string, handler: () => void): void => {
  const registered = GlobalShortcut.register(accelerator, handler);
  if (!registered) {
    console.warn('[desktop-shortcuts] failed to register', accelerator);
  }
};

applyWindowZoom();
mainWindow.webview?.on('dom-ready', applyWindowZoom);
mainWindow.webview?.on('did-navigate', applyWindowZoom);
mainWindow.webview?.on('did-navigate-in-page', applyWindowZoom);
if (isWaylandDesktop()) {
  console.log('[desktop-shortcuts] skipping native global shortcuts on Wayland');
} else {
  registerWindowShortcut('CommandOrControl+R', reloadWindow);
  registerWindowShortcut('CommandOrControl+Shift+R', reloadWindow);
  registerWindowShortcut('F5', reloadWindow);
  registerWindowShortcut('CommandOrControl+Shift+I', toggleWindowDevTools);
}

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
