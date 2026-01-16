import type { EditorTsSyncMessage } from '../types';
import { createSyncAck, isSyncMessage, parseSyncEnvelope } from './sync';

interface CloudflareWebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

export type CfSyncEnv = Record<string, string | undefined>;

export const createCfSyncWorker = (options?: {
  onSync?: (message: EditorTsSyncMessage) => Promise<void> | void;
}) => {
  const onSync = options?.onSync;

  return {
    fetch(request: Request, _env: CfSyncEnv): Response {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade required', { status: 426 });
      }

      const pair = new (((globalThis as unknown) as { WebSocketPair: { new(): CloudflareWebSocketPair } }).WebSocketPair)();
      const client = pair[0];
      const server = pair[1];

      const serverSocket = server as WebSocket & { accept?: () => void };
      serverSocket.accept?.();
      server.send(JSON.stringify(createSyncAck('connected')));

      server.addEventListener('message', async (event) => {
        const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const envelope = parseSyncEnvelope(data);
        if (!envelope || !isSyncMessage(envelope)) {
          server.send(JSON.stringify(createSyncAck('invalid-payload')));
          return;
        }

        if (onSync) {
          await onSync(envelope);
        }

        server.send(JSON.stringify(createSyncAck(envelope.key ?? 'page')));
      });

      return new Response(null, {
        status: 101,
        webSocket: client,
      } as ResponseInit);
    },
  };
};
