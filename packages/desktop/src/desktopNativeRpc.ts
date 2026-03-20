import type { ProjectFilesystemProvider } from 'editor-ts';
import { Electroview } from 'electrobun/view';
import type {
  DesktopPerfEvent,
  DesktopNativeState,
  DesktopOpenProjectResult,
  DesktopRecentProject,
  DesktopRendererLogMessage,
  DesktopRpcSchema,
  DesktopSettingKey,
  DesktopZoomAction,
} from './shared/desktopRpcSchema';

const normalizePath = (path: string): string => path.replace(/^\.\//, '').replace(/\\/g, '/');

const isHttpOrigin = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://');
};

type DesktopRpcClient = Awaited<ReturnType<typeof createDesktopRpcClient>>;
const DESKTOP_RPC_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

let desktopRpcClientPromise: Promise<DesktopRpcClient> | null = null;

export const isNativeDesktopRuntime = (): boolean => {
  return typeof window !== 'undefined' && window.__EDITORTS_DESKTOP__?.runtime === 'electrobun';
};

export const defaultHttpApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:2050';
  const origin = window.location.origin;
  return isHttpOrigin(origin) ? origin : 'http://127.0.0.1:2050';
};

const assertNativeDesktopRuntime = (): void => {
  if (!isNativeDesktopRuntime()) {
    throw new Error('EditorTs Desktop must run inside the Electrobun runtime.');
  }
};

async function createDesktopRpcClient() {
  const rpc = Electroview.defineRPC<DesktopRpcSchema>({
    maxRequestTime: DESKTOP_RPC_REQUEST_TIMEOUT_MS,
    handlers: {
      requests: {},
      messages: {},
    },
  });

  new Electroview({ rpc });
  return rpc;
}

const getDesktopRpcClient = async (): Promise<DesktopRpcClient> => {
  assertNativeDesktopRuntime();
  if (!desktopRpcClientPromise) {
    desktopRpcClientPromise = createDesktopRpcClient().catch((error: unknown) => {
      desktopRpcClientPromise = null;
      throw error;
    });
  }

  return desktopRpcClientPromise;
};

const requireDesktopRpcClient = async (): Promise<DesktopRpcClient> => {
  return getDesktopRpcClient();
};

export const fetchNativeDesktopState = async (): Promise<DesktopNativeState> => {
  const client = await getDesktopRpcClient();
  return client.requestProxy.getDesktopState();
};

export const persistNativeDesktopSetting = async (
  key: DesktopSettingKey,
  value: string,
): Promise<void> => {
  const client = await requireDesktopRpcClient();
  await client.requestProxy.setDesktopSetting({ key, value });
};

export const persistNativeRecentProject = async (
  projectPath: string,
  label?: string,
): Promise<void> => {
  const client = await requireDesktopRpcClient();
  await client.requestProxy.touchRecentProject({
    path: projectPath,
    label,
  });
};

export const openNativeProjectDirectory = async (
  startingFolder?: string,
): Promise<DesktopOpenProjectResult> => {
  const client = await getDesktopRpcClient();
  return client.requestProxy.openProjectDialog(
    startingFolder?.trim()
      ? { startingFolder: startingFolder.trim() }
      : undefined,
  );
};

export const sendRendererLog = async (payload: DesktopRendererLogMessage): Promise<void> => {
  const client = await getDesktopRpcClient();
  client.sendProxy.rendererLog(payload);
};

export const sendRendererPerfEvent = async (payload: DesktopPerfEvent): Promise<void> => {
  const client = await getDesktopRpcClient();
  client.sendProxy.perfEvent(payload);
};

export const toggleNativeDesktopDevTools = async (): Promise<void> => {
  const client = await getDesktopRpcClient();
  await client.requestProxy.toggleDesktopDevTools();
};

export const adjustNativeDesktopZoom = async (action: DesktopZoomAction): Promise<void> => {
  const client = await getDesktopRpcClient();
  await client.requestProxy.adjustDesktopZoom({ action });
};

export const createNativeProjectProvider = (root: string): ProjectFilesystemProvider => {
  const normalizedRoot = root.trim();
  let cachedFiles: string[] | null = null;

  return {
    listFiles: async () => {
      if (cachedFiles) {
        return [...cachedFiles];
      }
      const client = await requireDesktopRpcClient();
      const result = await client.requestProxy.listProjectFiles({ root: normalizedRoot });
      cachedFiles = result.files.map(normalizePath).sort((a, b) => a.localeCompare(b));
      return [...cachedFiles];
    },
    readFile: async (path: string) => {
      const client = await requireDesktopRpcClient();
      const result = await client.requestProxy.readProjectFile({
        root: normalizedRoot,
        path,
      });
      return result.content;
    },
    writeFile: async (path: string, content: string) => {
      const client = await requireDesktopRpcClient();
      await client.requestProxy.writeProjectFile({
        root: normalizedRoot,
        path,
        content,
      });
      cachedFiles = null;
    },
  };
};

export type { DesktopRecentProject };
