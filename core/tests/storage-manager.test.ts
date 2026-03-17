import { describe, expect, it } from 'bun:test';
import { StorageManager, SqlocalStorageAdapter } from '../src/core/StorageManager';
import type { SqlocalClient, StorageAdapter } from '../src/core/StorageManager';

class MemoryStorageAdapter implements StorageAdapter {
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

  async uploadImage(_file: File | Blob): Promise<string> {
    return 'memory://image';
  }

  async deleteImage(_url: string): Promise<void> {
    // noop
  }

  async listPages(): Promise<string[]> {
    return Array.from(this.pages.keys());
  }
}

describe('StorageManager', () => {
  it('delegates page operations to the adapter', async () => {
    const manager = new StorageManager({ type: 'local' });
    const adapter = new MemoryStorageAdapter();
    manager.setAdapter(adapter);

    await manager.savePage('page-1', 'data');
    await manager.savePage('page-2', 'more');

    expect(await manager.loadPage('page-1')).toBe('data');
    expect(await manager.listPages()).toEqual(['page-1', 'page-2']);

    await manager.deletePage('page-2');
    expect(await manager.listPages()).toEqual(['page-1']);
  });

  it('uses provided sqlocal client without dynamic import', async () => {
    const schemaStatements: string[] = [];
    const sqlocalClient: SqlocalClient = {
      sql: async (strings: TemplateStringsArray): Promise<Array<Record<string, unknown>>> => {
        schemaStatements.push(strings.join(''));
        return [];
      },
    };

    const adapter = new SqlocalStorageAdapter({
      type: 'sqlocal',
      client: sqlocalClient,
    });

    await adapter.listPages();

    expect(schemaStatements.length).toBeGreaterThanOrEqual(2);
    expect(schemaStatements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS editor_pages'))).toBe(true);
    expect(schemaStatements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS editor_images'))).toBe(true);
  });
});
