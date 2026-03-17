import { BrowserWindow, BuildConfig, PATHS } from 'electrobun/bun';

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

const desktopBoot = {
  runtime: 'electrobun',
  sqlitePath,
  userDataPath,
  rendererUrl,
  uiScale,
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

const applyWindowZoom = (): void => {
  mainWindow.setPageZoom(pageZoom);
};

applyWindowZoom();
mainWindow.webview?.on('dom-ready', applyWindowZoom);
mainWindow.webview?.on('did-navigate', applyWindowZoom);
mainWindow.webview?.on('did-navigate-in-page', applyWindowZoom);

process.on('exit', () => {
  db.close();
});
