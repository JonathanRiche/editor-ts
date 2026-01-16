import type { Database } from 'bun:sqlite';
import type { Server } from 'bun';
import type { PageMeta, PageMetaStore } from './sync';
import type { EditorTsSyncMessage } from '../types';
import { createSyncAck, isSyncMessage, parseSyncEnvelope } from './sync';

export interface BunSyncServer {
  server: Server<unknown>;
  close: () => void;
}

export const createBunPageMetaStore = (database: Database): PageMetaStore => {
  const init = () => {
    database.query(
      `
      CREATE TABLE IF NOT EXISTS editorts_page_meta (
        key TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    ).run();
  };

  const toRow = (meta: PageMeta) => ({
    key: meta.key,
    title: meta.title,
    item_id: meta.itemId,
    updated_at: meta.updatedAt,
  });

  const fromRow = (row: {
    key: string;
    title: string;
    item_id: number;
    updated_at: string;
  }): PageMeta => ({
    key: row.key,
    title: row.title,
    itemId: row.item_id,
    updatedAt: row.updated_at,
  });

  init();

  return {
    async save(meta) {
      const row = toRow(meta);
      database
        .query(
          `
          INSERT INTO editorts_page_meta (key, title, item_id, updated_at)
          VALUES ($key, $title, $item_id, $updated_at)
          ON CONFLICT(key) DO UPDATE SET
            title = excluded.title,
            item_id = excluded.item_id,
            updated_at = excluded.updated_at
        `
        )
        .run(row);
    },
    async get(key) {
      const row = database
        .query(
          `
          SELECT key, title, item_id, updated_at
          FROM editorts_page_meta
          WHERE key = $key
        `
        )
        .get({ key }) as
        | {
            key: string;
            title: string;
            item_id: number;
            updated_at: string;
          }
        | null;

      return row ? fromRow(row) : null;
    },
    async list() {
      const rows = database
        .query(
          `
          SELECT key, title, item_id, updated_at
          FROM editorts_page_meta
          ORDER BY updated_at DESC
        `
        )
        .all() as Array<{ key: string; title: string; item_id: number; updated_at: string }>;

      return rows.map((row) => fromRow(row));
    },
    async delete(key) {
      database
        .query(
          `
          DELETE FROM editorts_page_meta
          WHERE key = $key
        `
        )
        .run({ key });
    },
  };
};

export const createBunSyncServer = (options?: {
  port?: number;
  onSync?: (message: EditorTsSyncMessage) => Promise<void> | void;
}): BunSyncServer => {
  const port = options?.port ?? 8787;
  const onSync = options?.onSync;

  const server = Bun.serve({
    port,
    fetch(req) {
      const upgradeHeader = req.headers.get('upgrade');
      if (upgradeHeader?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade required', { status: 426 });
      }

      if (!server.upgrade(req)) {
        return new Response('Websocket upgrade failed', { status: 400 });
      }

      return new Response(null, { status: 101 });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify(createSyncAck('connected')));
      },
      async message(ws, data) {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data as BufferSource);
        const envelope = parseSyncEnvelope(text);
        if (!envelope || !isSyncMessage(envelope)) {
          ws.send(JSON.stringify(createSyncAck('invalid-payload')));
          return;
        }

        if (onSync) {
          await onSync(envelope);
        }

        ws.send(JSON.stringify(createSyncAck(envelope.key ?? 'page')));
      },
    },
  });

  return {
    server,
    close: () => server.stop(true),
  };
};
