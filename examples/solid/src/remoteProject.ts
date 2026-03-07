export const REMOTE_PROJECT_API_PREFIX = '/api/project';
export const REMOTE_PROJECT_FILES_PREFIX = `${REMOTE_PROJECT_API_PREFIX}/files`;
export const REMOTE_PROJECT_DB_TABLE = 'editorts_project_files';

type RemoteFile = {
  path: string;
  content: string;
  readOnly?: boolean;
  language?: string;
};

type D1Result<T> = {
  results?: T[];
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
};

export type D1Like = {
  prepare(query: string): D1PreparedStatement;
};

export type RemoteProjectEnv = {
  EDITOR_TS_REMOTE_DB?: D1Like;
};

type StoredRow = {
  path: string;
  content: string;
  read_only?: number;
  language?: string | null;
};

const remotePageJson = JSON.stringify({
  title: 'Remote content workspace',
  item_id: 7001,
  body: {
    assets: [],
    components: [
      {
        type: 'box',
        attributes: { id: 'remote-root' },
        components: [
          {
            type: 'text',
            tagName: 'h1',
            attributes: { id: 'remote-title' },
            content: 'Remote workspace stored behind your API',
          },
          {
            type: 'text',
            tagName: 'p',
            attributes: { id: 'remote-body' },
            content: 'This workspace is served from the same hosted app through a file API. In Cloudflare, bind a D1 database to persist it.',
          },
        ],
        style: '',
      },
    ],
    styles: [
      {
        selectors: [{ name: 'remote-root' }],
        style: {
          'min-height': '240px',
          padding: '2rem',
          'background-color': '#f5fbff',
          color: '#102033',
          'font-family': 'Georgia, serif',
          display: 'flex',
          'flex-direction': 'column',
          gap: '1rem',
        },
      },
      {
        selectors: [{ name: 'remote-title' }],
        style: {
          'font-size': 'clamp(2rem, 5vw, 3.2rem)',
          margin: '0',
          color: '#12365a',
        },
      },
      {
        selectors: [{ name: 'remote-body' }],
        style: {
          'max-width': '42rem',
          'line-height': '1.65',
          margin: '0',
        },
      },
    ],
  },
}, null, 2);

const remoteFiles = (): RemoteFile[] => {
  return [
    {
      path: 'page.json',
      content: remotePageJson,
      language: 'json',
    },
    {
      path: 'remote-workspace.md',
      content: [
        '# Remote Workspace',
        '',
        'This example stores file content behind a same-origin HTTP API.',
        'Bind `EDITOR_TS_REMOTE_DB` to a Cloudflare D1 database for persistence.',
      ].join('\n'),
      readOnly: true,
      language: 'markdown',
    },
  ];
};

const inferLanguage = (path: string): string => {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript';
  return 'plaintext';
};

const getMemoryStore = (): Map<string, RemoteFile> => {
  const host = globalThis as typeof globalThis & {
    __editortsRemoteProjectStore?: Map<string, RemoteFile>;
  };

  if (!host.__editortsRemoteProjectStore) {
    host.__editortsRemoteProjectStore = new Map(remoteFiles().map((file) => [file.path, file]));
  }

  return host.__editortsRemoteProjectStore;
};

const normalizePath = (path: string): string => {
  return path.replace(/^\/+/, '').replace(/\\/g, '/');
};

const decodePath = (pathname: string): string => {
  const suffix = pathname.startsWith(REMOTE_PROJECT_FILES_PREFIX)
    ? pathname.slice(REMOTE_PROJECT_FILES_PREFIX.length)
    : '';

  return normalizePath(decodeURIComponent(suffix));
};

const json = (payload: unknown, status = 200): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
};

const ensureD1 = async (db: D1Like): Promise<void> => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ${REMOTE_PROJECT_DB_TABLE} (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      updated_at TEXT NOT NULL
    )
  `).run();

  const count = await db.prepare(`SELECT COUNT(*) AS count FROM ${REMOTE_PROJECT_DB_TABLE}`).first<{ count?: number | string }>();
  const total = Number(count?.count ?? 0);
  if (total > 0) return;

  const stamp = new Date().toISOString();
  await Promise.all(remoteFiles().map((file) => {
    return db.prepare(`
      INSERT INTO ${REMOTE_PROJECT_DB_TABLE} (path, content, read_only, language, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(file.path, file.content, file.readOnly ? 1 : 0, file.language ?? inferLanguage(file.path), stamp).run();
  }));
};

const listFromD1 = async (db: D1Like): Promise<RemoteFile[]> => {
  await ensureD1(db);
  const result = await db.prepare(`
    SELECT path, content, read_only, language
    FROM ${REMOTE_PROJECT_DB_TABLE}
    ORDER BY path ASC
  `).all<StoredRow>();

  return (result.results ?? []).map((row) => ({
    path: row.path,
    content: row.content,
    readOnly: row.read_only === 1,
    language: row.language ?? inferLanguage(row.path),
  }));
};

const listFromMemory = (): RemoteFile[] => {
  return Array.from(getMemoryStore().values()).sort((a, b) => a.path.localeCompare(b.path));
};

const readFile = async (env: RemoteProjectEnv | undefined, path: string): Promise<RemoteFile | null> => {
  const cleanPath = normalizePath(path);
  if (!cleanPath) return null;

  if (env?.EDITOR_TS_REMOTE_DB) {
    await ensureD1(env.EDITOR_TS_REMOTE_DB);
    const row = await env.EDITOR_TS_REMOTE_DB.prepare(`
      SELECT path, content, read_only, language
      FROM ${REMOTE_PROJECT_DB_TABLE}
      WHERE path = ?
    `).bind(cleanPath).first<StoredRow>();

    if (!row) return null;

    return {
      path: row.path,
      content: row.content,
      readOnly: row.read_only === 1,
      language: row.language ?? inferLanguage(row.path),
    };
  }

  return getMemoryStore().get(cleanPath) ?? null;
};

const writeFile = async (env: RemoteProjectEnv | undefined, path: string, content: string): Promise<RemoteFile | null> => {
  const cleanPath = normalizePath(path);
  if (!cleanPath) return null;

  const existing = await readFile(env, cleanPath);
  if (existing?.readOnly) {
    throw new Error(`Path is read-only: ${cleanPath}`);
  }

  if (env?.EDITOR_TS_REMOTE_DB) {
    await ensureD1(env.EDITOR_TS_REMOTE_DB);
    await env.EDITOR_TS_REMOTE_DB.prepare(`
      INSERT INTO ${REMOTE_PROJECT_DB_TABLE} (path, content, read_only, language, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        content = excluded.content,
        language = excluded.language,
        updated_at = excluded.updated_at
    `).bind(cleanPath, content, 0, inferLanguage(cleanPath), new Date().toISOString()).run();

    return readFile(env, cleanPath);
  }

  const next: RemoteFile = {
    path: cleanPath,
    content,
    language: inferLanguage(cleanPath),
  };
  getMemoryStore().set(cleanPath, next);
  return next;
};

const listFiles = async (env?: RemoteProjectEnv): Promise<RemoteFile[]> => {
  if (env?.EDITOR_TS_REMOTE_DB) {
    return listFromD1(env.EDITOR_TS_REMOTE_DB);
  }

  return listFromMemory();
};

export const handleRemoteProjectRequest = async (request: Request, env?: RemoteProjectEnv): Promise<Response | null> => {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === REMOTE_PROJECT_FILES_PREFIX && request.method === 'GET') {
    const files = await listFiles(env);
    return json({
      files: files.map((file) => ({
        path: file.path,
        readOnly: file.readOnly,
        language: file.language ?? inferLanguage(file.path),
      })),
    });
  }

  if (pathname.startsWith(`${REMOTE_PROJECT_FILES_PREFIX}/`) && request.method === 'GET') {
    const file = await readFile(env, decodePath(pathname));
    if (!file) return json({ content: null }, 404);
    return json({ content: file.content });
  }

  if (pathname.startsWith(`${REMOTE_PROJECT_FILES_PREFIX}/`) && request.method === 'PUT') {
    const payload = (await request.json()) as { content?: unknown };
    const content = typeof payload.content === 'string' ? payload.content : '';

    try {
      const file = await writeFile(env, decodePath(pathname), content);
      if (!file) return json({ error: 'Invalid path' }, 400);
      return json({ ok: true, path: file.path });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 403);
    }
  }

  return null;
};
