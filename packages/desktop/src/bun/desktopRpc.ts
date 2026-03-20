import { defineElectrobunRPC } from 'electrobun/bun';

import type { Database } from 'bun:sqlite';

import type { DesktopPerfEvent, DesktopRendererLogMessage, DesktopRpcSchema, DesktopZoomAction } from '../shared/desktopRpcSchema';
import { createDesktopService } from './server';

type DesktopRpcOptions = {
  db: Database;
  sqlitePath: string;
  userDataPath: string;
  onToggleDevTools?: () => void;
  onAdjustZoom?: (action: DesktopZoomAction) => void;
  onPerfEvent?: (event: Omit<DesktopPerfEvent, 'sessionId'>) => void;
};

const rpcDebugEnabled = (): boolean => {
  return process.env.EDITORTS_DESKTOP_RPC_DEBUG === '1';
};

const serializeLogValue = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const createDesktopRpc = (options: DesktopRpcOptions) => {
  const service = createDesktopService(options);

  const wrapRequest = <TParams, TResponse>(
    method: string,
    handler: (params: TParams) => Promise<TResponse> | TResponse,
  ) => {
    return async (params: TParams): Promise<TResponse> => {
      const startedAt = Date.now();
      if (rpcDebugEnabled()) {
        // console.log(`[desktop-rpc] -> ${method} ${serializeLogValue(params)}`);
      }

      try {
        const result = await handler(params);
        options.onPerfEvent?.({
          origin: 'main',
          kind: 'rpc',
          name: method,
          at: Date.now(),
          fields: {
            durationMs: Date.now() - startedAt,
            ok: true,
          },
        });
        if (rpcDebugEnabled()) {
          // console.log(`[desktop-rpc] <- ${method} ${Date.now() - startedAt}ms ${serializeLogValue(result)}`);
        }
        return result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        options.onPerfEvent?.({
          origin: 'main',
          kind: 'rpc',
          name: method,
          at: Date.now(),
          fields: {
            durationMs: Date.now() - startedAt,
            ok: false,
            error: message,
          },
        });
        if (rpcDebugEnabled()) {
          console.error(`[desktop-rpc] !! ${method} ${Date.now() - startedAt}ms ${message}`);
        }
        throw error;
      }
    };
  };

  const logRendererMessage = (payload: DesktopRendererLogMessage): void => {
    const stackSuffix = payload.stack?.trim() ? `\n${payload.stack.trim()}` : '';
    const line = `[desktop-renderer:${payload.level}] ${payload.source} ${payload.message}${stackSuffix}`;
    if (payload.level === 'error') {
      console.error(line);
      return;
    }
    if (payload.level === 'warn') {
      console.warn(line);
      return;
    }
    // console.log(line);
  };

  return defineElectrobunRPC<DesktopRpcSchema, 'bun'>('bun', {
    handlers: {
      requests: {
        getDesktopState: wrapRequest('getDesktopState', () => service.getState()),
        setDesktopSetting: wrapRequest('setDesktopSetting', (params) => service.setSetting(params)),
        openProjectDialog: wrapRequest('openProjectDialog', (params) => service.openProject(params)),
        touchRecentProject: wrapRequest('touchRecentProject', (params) => service.touchRecentProject(params)),
        listProjectFiles: wrapRequest('listProjectFiles', (params) => service.listProjectFiles(params)),
        readProjectFile: wrapRequest('readProjectFile', (params) => service.readProjectFile(params)),
        writeProjectFile: wrapRequest('writeProjectFile', (params) => service.writeProjectFile(params)),
        loadDesktopStoragePage: wrapRequest('loadDesktopStoragePage', (params) => service.loadDesktopStoragePage(params)),
        saveDesktopStoragePage: wrapRequest('saveDesktopStoragePage', (params) => service.saveDesktopStoragePage(params)),
        deleteDesktopStoragePage: wrapRequest('deleteDesktopStoragePage', (params) => service.deleteDesktopStoragePage(params)),
        toggleDesktopDevTools: wrapRequest('toggleDesktopDevTools', () => {
          options.onToggleDevTools?.();
          return { ok: true as const };
        }),
        adjustDesktopZoom: wrapRequest('adjustDesktopZoom', (params) => {
          options.onAdjustZoom?.(params.action);
          return { ok: true as const };
        }),
      },
      messages: {
        rendererLog: (payload: DesktopRendererLogMessage) => {
          logRendererMessage(payload);
        },
        perfEvent: (payload: DesktopPerfEvent) => {
          options.onPerfEvent?.(payload);
        },
      },
    },
  });
};
