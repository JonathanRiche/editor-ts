import { BrowserWindow } from 'electrobun/bun';

import { openDesktopDatabase } from './storage';
import { startDesktopApiServer } from './server';

const DEFAULT_DESKTOP_RENDERER_URL = 'http://localhost:2050';

const { db, sqlitePath, userDataPath } = openDesktopDatabase();
const nativeApiServer = startDesktopApiServer({
  db,
  sqlitePath,
  userDataPath,
});

const rendererUrl = (process.env.EDITORTS_DESKTOP_URL ?? DEFAULT_DESKTOP_RENDERER_URL).trim();
const nativeApiBaseUrl = `http://127.0.0.1:${nativeApiServer.port}`;
const configuredZoom = Number(process.env.EDITORTS_DESKTOP_ZOOM ?? '');
const pageZoom = Number.isFinite(configuredZoom) && configuredZoom > 0
  ? configuredZoom
  : process.platform === 'linux'
    ? 0.8
    : 1;

const desktopBoot = {
  runtime: 'electrobun',
  sqlitePath,
  userDataPath,
  rendererUrl,
  nativeApiBaseUrl,
} as const;

const preloadScript = `
  window.__EDITORTS_DESKTOP__ = ${JSON.stringify(desktopBoot)};
`;

const mainWindow = new BrowserWindow({
  title: 'EditorTs Desktop',
  url: rendererUrl,
  width: 1600,
  height: 1040,
  resizable: true,
  devTools: true,
  backgroundColor: '#161b24',
  preload: preloadScript,
});

const applyWindowZoom = (): void => {
  mainWindow.setPageZoom(pageZoom);
};

applyWindowZoom();
mainWindow.webview?.on('dom-ready', applyWindowZoom);
mainWindow.webview?.on('did-navigate', applyWindowZoom);
mainWindow.webview?.on('did-navigate-in-page', applyWindowZoom);

process.on('exit', () => {
  nativeApiServer.stop(true);
  db.close();
});
