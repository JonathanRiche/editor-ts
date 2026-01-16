import type { Server } from 'bun';
import type { EditorTsSyncMessage } from '../types';
import { createSyncAck, isSyncMessage, parseSyncEnvelope } from './sync';

export interface BunSyncServer {
  server: Server<unknown>;
  close: () => void;
}

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
