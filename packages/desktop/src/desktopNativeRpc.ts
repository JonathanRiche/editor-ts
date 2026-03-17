import type { ProjectFilesystemProvider } from 'editor-ts';
import type {
  DesktopNativeState,
  DesktopOpenProjectResult,
  DesktopRecentProject,
  DesktopRpcSchema,
  DesktopSettingKey,
} from './shared/desktopRpcSchema';

const normalizePath = (path: string): string => path.replace(/^\.\//, '').replace(/\\/g, '/');

const isHttpOrigin = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://');
};

type DesktopRpcClient = Awaited<ReturnType<typeof createDesktopRpcClient>>;

let desktopRpcClientPromise: Promise<DesktopRpcClient | null> | null = null;

export const isNativeDesktopRuntime = (): boolean => {
  return typeof window !== 'undefined' && window.__EDITORTS_DESKTOP__?.runtime === 'electrobun';
};

export const defaultHttpApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:2050';
  const origin = window.location.origin;
  return isHttpOrigin(origin) ? origin : 'http://127.0.0.1:2050';
};

async function createDesktopRpcClient() {
  const { Electroview } = await import('electrobun/view');
  const rpc = Electroview.defineRPC<DesktopRpcSchema>({
    handlers: {
      requests: {},
      messages: {},
    },
  });

  new Electroview({ rpc });
  return rpc;
}

const getDesktopRpcClient = async (): Promise<DesktopRpcClient | null> => {
  if (!isNativeDesktopRuntime()) return null;

  if (!desktopRpcClientPromise) {
    desktopRpcClientPromise = createDesktopRpcClient().catch((error: unknown) => {
      desktopRpcClientPromise = null;
      throw error;
    });
  }

  return desktopRpcClientPromise;
};

const requireDesktopRpcClient = async (): Promise<DesktopRpcClient> => {
  const client = await getDesktopRpcClient();
  if (!client) {
    throw new Error('Electrobun desktop RPC is unavailable in this runtime.');
  }
  return client;
};

export const fetchNativeDesktopState = async (): Promise<DesktopNativeState | null> => {
  const client = await getDesktopRpcClient();
  if (!client) return null;
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
): Promise<DesktopOpenProjectResult | null> => {
  const client = await getDesktopRpcClient();
  if (!client) return null;

  return client.requestProxy.openProjectDialog(
    startingFolder?.trim()
      ? { startingFolder: startingFolder.trim() }
      : undefined,
  );
};

export const createNativeProjectProvider = (root: string): ProjectFilesystemProvider => {
  const normalizedRoot = root.trim();

  return {
    listFiles: async () => {
      const client = await requireDesktopRpcClient();
      const result = await client.requestProxy.listProjectFiles({ root: normalizedRoot });
      return result.files.map(normalizePath).sort((a, b) => a.localeCompare(b));
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
    },
  };
};

export type { DesktopRecentProject };
