import { BrowserWindow, BuildConfig, GlobalShortcut, PATHS } from 'electrobun/bun';

import { createDesktopRpc } from './desktopRpc';
import { openDesktopDatabase } from './storage';

const DEFAULT_DESKTOP_RENDERER_URL = 'http://localhost:2050';

const buildConfig = await BuildConfig.get();
const bundledRendererEntry = typeof buildConfig.runtime?.desktopRendererEntry === 'string'
  ? buildConfig.runtime.desktopRendererEntry.trim()
  : '';
const usingBundledRenderer = bundledRendererEntry.length > 0 && !process.env.EDITORTS_DESKTOP_URL;

const { db, sqlitePath, userDataPath } = openDesktopDatabase();
const desktopRpc = createDesktopRpc({
  db,
  sqlitePath,
  userDataPath,
});

const rendererUrl = (process.env.EDITORTS_DESKTOP_URL
  ?? (usingBundledRenderer ? bundledRendererEntry : DEFAULT_DESKTOP_RENDERER_URL)).trim();
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
} as const;

const preloadScript = `
  window.__EDITORTS_DESKTOP__ = ${JSON.stringify(desktopBoot)};
`;

const mainWindow = new BrowserWindow({
  title: 'EditorTs Desktop',
  url: rendererUrl,
  viewsRoot: usingBundledRenderer ? PATHS.VIEWS_FOLDER : null,
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
registerWindowShortcut('CommandOrControl+R', reloadWindow);
registerWindowShortcut('CommandOrControl+Shift+R', reloadWindow);
registerWindowShortcut('F5', reloadWindow);
registerWindowShortcut('CommandOrControl+Shift+I', toggleWindowDevTools);

process.on('exit', () => {
  if (pendingReloadTimer !== null) {
    clearTimeout(pendingReloadTimer);
  }
  GlobalShortcut.unregisterAll();
  db.close();
});
