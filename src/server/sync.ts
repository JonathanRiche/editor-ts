import type { StorageAdapter } from '../core/StorageManager';
import type { PageData, EditorTsSyncAck, EditorTsSyncEnvelope, EditorTsSyncMessage, PagePayload } from '../types';

export type ServerPageMeta = {
  key: string;
  updatedAt: number;
  checksum?: string;
};

export type ServerFile = {
  path: string;
  content: string;
};

export type ServerSyncAdapter = {
  listPages(): Promise<ServerPageMeta[]>;
  listFiles(pageKey: string): Promise<ServerFile[]>;
  saveFiles(pageKey: string, files: ServerFile[]): Promise<void>;
};

export type FrontendSyncOptions = {
  pageKey: string;
  storage: StorageAdapter;
  adapter: ServerSyncAdapter;
  includeFiles?: (path: string) => boolean;
  onStatus?: (status: FrontendSyncStatus) => void;
};

export type FrontendSyncStatus =
  | { state: 'loading' }
  | { state: 'saving' }
  | { state: 'idle' }
  | { state: 'error'; message: string };

export interface PageMeta {
  key: string;
  title: string;
  itemId: number;
  updatedAt: string;
}

export interface PageMetaStore {
  save(meta: PageMeta): Promise<void>;
  get(key: string): Promise<PageMeta | null>;
  list(): Promise<PageMeta[]>;
  delete(key: string): Promise<void>;
}

const defaultIncludeFiles = (path: string): boolean => {
  return path === 'page.json' || path === 'styles.css' || path === 'index.html' || path.startsWith('components/');
};

const safeParseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const encodeStorageKey = (pageKey: string, path: string): string => {
  return `${pageKey}:${path}`;
};

const decodeStorageKey = (pageKey: string, storageKey: string): string => {
  return storageKey.replace(`${pageKey}:`, '');
};

const computeChecksum = (content: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const updateStatus = (options: FrontendSyncOptions, status: FrontendSyncStatus) => {
  options.onStatus?.(status);
};

export const syncFrontendWithServer = async (options: FrontendSyncOptions): Promise<void> => {
  const { pageKey, storage, adapter } = options;
  const includeFiles = options.includeFiles ?? defaultIncludeFiles;

  try {
    updateStatus(options, { state: 'loading' });

    const remotePages = await adapter.listPages();
    const remoteMeta = remotePages.find((page) => page.key === pageKey);

    const localMetaKey = encodeStorageKey(pageKey, 'meta');
    const localMeta = safeParseJson<ServerPageMeta>(await storage.loadPage(localMetaKey));

    if (remoteMeta && (!localMeta || remoteMeta.updatedAt > localMeta.updatedAt)) {
      const remoteFiles = await adapter.listFiles(pageKey);
      const filtered = remoteFiles.filter((file) => includeFiles(file.path));

      await Promise.all(
        filtered.map(async (file) => {
          await storage.savePage(encodeStorageKey(pageKey, file.path), file.content);
        })
      );

      await storage.savePage(localMetaKey, JSON.stringify(remoteMeta));
      updateStatus(options, { state: 'idle' });
      return;
    }

    updateStatus(options, { state: 'saving' });

    const storedKeys = await storage.listPages();
    const pageKeys = storedKeys.filter((key) => key.startsWith(`${pageKey}:`));

    const fileKeys = pageKeys.filter((key) => {
      const path = decodeStorageKey(pageKey, key);
      return path !== 'meta' && includeFiles(path);
    });

    const files = await Promise.all(
      fileKeys.map(async (key) => {
        const content = (await storage.loadPage(key)) ?? '';
        return {
          path: decodeStorageKey(pageKey, key),
          content,
        };
      })
    );

    await adapter.saveFiles(pageKey, files);

    const payload: ServerPageMeta = {
      key: pageKey,
      updatedAt: Date.now(),
      checksum: computeChecksum(files.map((file) => file.content).join('|')),
    };

    await storage.savePage(localMetaKey, JSON.stringify(payload));
    updateStatus(options, { state: 'idle' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    updateStatus(options, { state: 'error', message });
  }
};

export const createPageMeta = (
  key: string,
  page: PageData,
  options?: { updatedAt?: string }
): PageMeta => {
  return {
    key,
    title: page.title,
    itemId: page.item_id,
    updatedAt: options?.updatedAt ?? new Date().toISOString(),
  };
};

export const isSyncMessage = (message: EditorTsSyncEnvelope): message is EditorTsSyncMessage => {
  return message.type === 'page';
};

export const isSyncAck = (message: EditorTsSyncEnvelope): message is EditorTsSyncAck => {
  return message.type === 'ack';
};

export const createSyncMessage = (payload: PagePayload, options?: { key?: string }): EditorTsSyncMessage => {
  return {
    type: 'page',
    payload,
    key: options?.key,
    sentAt: new Date().toISOString(),
  };
};

export const createSyncAck = (messageId: string): EditorTsSyncAck => {
  return {
    type: 'ack',
    messageId,
    receivedAt: new Date().toISOString(),
  };
};

export const parseSyncEnvelope = (raw: string): EditorTsSyncEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as EditorTsSyncEnvelope;
    if (parsed && (parsed.type === 'page' || parsed.type === 'ack')) {
      return parsed;
    }
  } catch (error: unknown) {
    return null;
  }
  return null;
};
