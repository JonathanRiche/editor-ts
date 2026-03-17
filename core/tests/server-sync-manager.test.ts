import { describe, expect, it } from 'bun:test';
import { syncFrontendWithServer } from '../src/server/sync';
import type { ServerFile, ServerPageMeta, ServerSyncAdapter } from '../src/server/sync';
import type { StorageAdapter } from '../src/core/StorageManager';

class MemoryStorage implements StorageAdapter {
  private pages = new Map<string, string>();

  async savePage(key: string, data: string): Promise<void> {
    this.pages.set(key, data);
  }

  async loadPage(key: string): Promise<string | null> {
    return this.pages.get(key) ?? null;
  }

  async deletePage(key: string): Promise<void> {
    this.pages.delete(key);
  }

  async uploadImage(): Promise<string> {
    return 'memory://image';
  }

  async deleteImage(): Promise<void> {
    // noop
  }

  async listPages(): Promise<string[]> {
    return Array.from(this.pages.keys());
  }
}

describe('syncFrontendWithServer', () => {
  it('pulls remote files when remote meta is newer', async () => {
    const storage = new MemoryStorage();
    const remoteFiles: ServerFile[] = [
      { path: 'page.json', content: '{"title":"Remote"}' },
    ];

    const adapter: ServerSyncAdapter = {
      listPages: async () => [{ key: 'page', updatedAt: 10 }],
      listFiles: async () => remoteFiles,
      saveFiles: async () => {},
    };

    await syncFrontendWithServer({
      pageKey: 'page',
      storage,
      adapter,
    });

    const stored = await storage.loadPage('page:page.json');
    const meta = await storage.loadPage('page:meta');

    expect(stored).toBe('{"title":"Remote"}');
    expect(meta).not.toBeNull();
  });

  it('pushes local files when local meta is newer', async () => {
    const storage = new MemoryStorage();
    const savedFiles: ServerFile[] = [];

    await storage.savePage('page:page.json', '{"title":"Local"}');
    await storage.savePage('page:meta', JSON.stringify({ key: 'page', updatedAt: 20 } satisfies ServerPageMeta));

    const adapter: ServerSyncAdapter = {
      listPages: async () => [{ key: 'page', updatedAt: 10 }],
      listFiles: async () => [],
      saveFiles: async (_pageKey, files) => {
        savedFiles.push(...files);
      },
    };

    await syncFrontendWithServer({
      pageKey: 'page',
      storage,
      adapter,
    });

    expect(savedFiles[0]?.path).toBe('page.json');
    expect(savedFiles[0]?.content).toBe('{"title":"Local"}');
  });

  it('respects includeFiles filter and reports errors', async () => {
    const storage = new MemoryStorage();
    await storage.savePage('page:page.json', 'local');
    await storage.savePage('page:meta', JSON.stringify({ key: 'page', updatedAt: 20 } satisfies ServerPageMeta));

    const adapter: ServerSyncAdapter = {
      listPages: async () => [{ key: 'page', updatedAt: 10 }],
      listFiles: async () => [{ path: 'page.json', content: 'data' }],
      saveFiles: async () => {
        throw new Error('fail');
      },
    };

    const statuses: string[] = [];

    await syncFrontendWithServer({
      pageKey: 'page',
      storage,
      adapter,
      includeFiles: (path) => path === 'styles.css',
      onStatus: (status) => statuses.push(status.state),
    });

    const stored = await storage.loadPage('page:page.json');

    expect(stored).toBe('local');
    expect(statuses).toContain('error');
  });
});
