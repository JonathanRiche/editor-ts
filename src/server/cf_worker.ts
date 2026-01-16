import type { PageMeta, PageMetaStore } from './sync';

type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

type DurableObjectId = {
  toString(): string;
};

type DurableObjectStub = {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
};

type DurableObjectStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
};

type DurableObjectState = {
  id: DurableObjectId;
  storage: DurableObjectStorage;
};

type DurableObject = {
  fetch(request: Request): Promise<Response>;
};

export const createCfPageMetaStore = (namespace: DurableObjectNamespace): PageMetaStore => {
  return {
    async save(meta) {
      const id = namespace.idFromName(meta.key);
      const stub = namespace.get(id);
      await stub.fetch('https://editor-ts.local/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(meta),
      });
    },
    async get(key) {
      const id = namespace.idFromName(key);
      const stub = namespace.get(id);
      const response = await stub.fetch('https://editor-ts.local/meta');
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Failed to fetch page meta: ${response.statusText}`);
      }
      return (await response.json()) as PageMeta;
    },
    async list() {
      const id = namespace.idFromName('index');
      const stub = namespace.get(id);
      const response = await stub.fetch('https://editor-ts.local/meta/index');
      if (!response.ok) {
        throw new Error(`Failed to list page meta: ${response.statusText}`);
      }
      return (await response.json()) as PageMeta[];
    },
    async delete(key) {
      const id = namespace.idFromName(key);
      const stub = namespace.get(id);
      const response = await stub.fetch('https://editor-ts.local/meta', {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to delete page meta: ${response.statusText}`);
      }
    },
  };
};

export class EditorTsPageMetaDurableObject implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/meta/index' && request.method === 'GET') {
      const list = (await this.state.storage.get<PageMeta[]>('index')) ?? [];
      return new Response(JSON.stringify(list), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname !== '/meta') {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'GET') {
      const meta = await this.state.storage.get<PageMeta>('meta');
      if (!meta) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(meta), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.method === 'POST') {
      const meta = (await request.json()) as PageMeta;
      await this.state.storage.put('meta', meta);

      const indexId = this.env.EDITOR_TS_META.idFromName('index');
      const indexStub = this.env.EDITOR_TS_META.get(indexId);
      await indexStub.fetch('https://editor-ts.local/meta/index', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(meta),
      });

      return new Response('ok');
    }

    if (request.method === 'DELETE') {
      await this.state.storage.delete('meta');

      const indexId = this.env.EDITOR_TS_META.idFromName('index');
      const indexStub = this.env.EDITOR_TS_META.get(indexId);
      await indexStub.fetch('https://editor-ts.local/meta/index', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: this.state.id.toString() }),
      });

      return new Response('ok');
    }

    return new Response('Method not allowed', { status: 405 });
  }
}

export class EditorTsPageMetaIndexDurableObject implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/meta/index') {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'GET') {
      const list = (await this.state.storage.get<PageMeta[]>('index')) ?? [];
      return new Response(JSON.stringify(list), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (request.method === 'POST') {
      const meta = (await request.json()) as PageMeta;
      const list = (await this.state.storage.get<PageMeta[]>('index')) ?? [];
      const next = list.filter((entry: PageMeta) => entry.key !== meta.key);
      next.push(meta);
      next.sort((a: PageMeta, b: PageMeta) => b.updatedAt.localeCompare(a.updatedAt));
      await this.state.storage.put('index', next);
      return new Response('ok');
    }

    if (request.method === 'DELETE') {
      const payload = (await request.json()) as { key?: string };
      const key = payload.key ?? '';
      const list = (await this.state.storage.get<PageMeta[]>('index')) ?? [];
      const next = list.filter((entry: PageMeta) => entry.key !== key);
      await this.state.storage.put('index', next);
      return new Response('ok');
    }

    return new Response('Method not allowed', { status: 405 });
  }
}

interface Env {
  EDITOR_TS_META: DurableObjectNamespace;
}

export type { DurableObjectNamespace, DurableObject, DurableObjectState, DurableObjectStorage, DurableObjectId, DurableObjectStub };

