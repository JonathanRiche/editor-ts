import { describe, expect, it } from 'bun:test';
import { createBunPageMetaStore } from '../core/src/server/bun_server';
import type { PageMeta } from '../core/src/server/sync';

type Statement = {
  run: (params?: Record<string, unknown>) => void;
  get: (params?: Record<string, unknown>) => unknown;
  all: () => unknown[];
};

type Database = {
  query: (sql: string) => Statement;
};

const createDatabase = () => {
  const rows = new Map<string, PageMeta>();

  const query = (sql: string): Statement => {
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith('insert')) {
      return {
        run: (params?: Record<string, unknown>) => {
          const key = params?.key as string;
          rows.set(key, {
            key,
            title: String(params?.title ?? ''),
            itemId: Number(params?.item_id ?? 0),
            updatedAt: String(params?.updated_at ?? ''),
          });
        },
        get: () => null,
        all: () => [],
      };
    }

    if (normalized.startsWith('select') && normalized.includes('where')) {
      return {
        run: () => {},
        get: (params?: Record<string, unknown>) => {
          const key = params?.key as string;
          const item = rows.get(key);
          if (!item) return null;
          return {
            key: item.key,
            title: item.title,
            item_id: item.itemId,
            updated_at: item.updatedAt,
          };
        },
        all: () => [],
      };
    }

    if (normalized.startsWith('select')) {
      return {
        run: () => {},
        get: () => null,
        all: () => Array.from(rows.values()).map((item) => ({
          key: item.key,
          title: item.title,
          item_id: item.itemId,
          updated_at: item.updatedAt,
        })),
      };
    }

    if (normalized.startsWith('delete')) {
      return {
        run: (params?: Record<string, unknown>) => {
          const key = params?.key as string;
          rows.delete(key);
        },
        get: () => null,
        all: () => [],
      };
    }

    return {
      run: () => {},
      get: () => null,
      all: () => [],
    };
  };

  return { query } satisfies Database;
};

describe('createBunPageMetaStore', () => {
  it('stores and retrieves page metadata', async () => {
    const db = createDatabase();
    const store = createBunPageMetaStore(db as unknown as import('bun:sqlite').Database);

    const meta: PageMeta = {
      key: 'page-1',
      title: 'Hello',
      itemId: 2,
      updatedAt: '2026-01-16T00:00:00Z',
    };

    await store.save(meta);

    const loaded = await store.get('page-1');
    expect(loaded).toEqual(meta);

    const list = await store.list();
    expect(list).toHaveLength(1);

    await store.delete('page-1');
    expect(await store.get('page-1')).toBeNull();
  });
});
