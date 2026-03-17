import { describe, expect, it } from 'bun:test';
import { createCfPageMetaStore, createCfSyncWorker } from '../src/server/cf_worker';
import type { EditorTsSyncMessage } from '../src/types';
import type { PageMeta } from '../src/server/sync';

type Stub = {
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

type Namespace = {
  idFromName: (name: string) => { toString: () => string };
  get: (id: { toString: () => string }) => Stub;
};

const createNamespace = () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const stubs = new Map<string, Stub>();

  const makeStub = (key: string): Stub => ({
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body?.toString() });

      if (url.endsWith('/meta')) {
        if (init?.method === 'POST') {
          return new Response('ok');
        }
        if (init?.method === 'DELETE') {
          return new Response('ok');
        }
        return new Response(JSON.stringify({ key, title: 'Title', itemId: 1, updatedAt: 'now' }), {
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/meta/index')) {
        return new Response(JSON.stringify([{ key }]), {
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    calls,
    namespace: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: (id: { toString: () => string }) => {
        const key = id.toString();
        if (!stubs.has(key)) {
          stubs.set(key, makeStub(key));
        }
        return stubs.get(key)!;
      },
    } as Namespace,
  };
};

describe('createCfPageMetaStore', () => {
  it('calls durable object endpoints', async () => {
    const { calls, namespace } = createNamespace();
    const store = createCfPageMetaStore(namespace as unknown as import('../src/server/cf_worker').DurableObjectNamespace);

    const meta: PageMeta = {
      key: 'page-1',
      title: 'Title',
      itemId: 1,
      updatedAt: 'now',
    };

    await store.save(meta);
    await store.get('page-1');
    await store.list();
    await store.delete('page-1');

    expect(calls.some((call) => call.url.endsWith('/meta'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/meta/index'))).toBe(true);
  });
});

describe('createCfSyncWorker', () => {
  it('acknowledges websocket sync messages', async () => {
    const messages: EditorTsSyncMessage[] = [];
    const worker = createCfSyncWorker({
      onSync: async (message) => {
        messages.push(message);
      },
    });

    let sent: string[] = [];
    const serverSocket = {
      accept: () => {},
      send: (payload: string) => {
        sent.push(payload);
      },
      addEventListener: (_: string, handler: (event: { data: string }) => void) => {
        handler({ data: JSON.stringify({ type: 'page', key: 'page', payload: { title: 'T', item_id: 1, body: {} }, sentAt: 'now' }) });
      },
    } as unknown as WebSocket & { accept?: () => void };

    const clientSocket = {} as WebSocket;

    (globalThis as unknown as { WebSocketPair?: { new(): { 0: WebSocket; 1: WebSocket } } }).WebSocketPair = class {
      0 = clientSocket;
      1 = serverSocket;
    };

    const response = worker.fetch(new Request('https://example.com', { headers: { upgrade: 'websocket' } }), {});

    expect(response.status).toBe(101);
    expect(messages).toHaveLength(1);
    expect(sent.some((payload) => payload.includes('ack'))).toBe(true);
  });
});
