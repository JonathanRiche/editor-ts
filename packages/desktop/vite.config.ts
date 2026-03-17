import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath, URL } from 'node:url';

const OPENCODE_BROWSER_STUB = fileURLToPath(new URL('../starter-shared/src/opencode-sdk-browser.ts', import.meta.url));
const OPENCODE_SERVER_BROWSER_STUB = fileURLToPath(new URL('../starter-shared/src/opencode-sdk-server-browser.ts', import.meta.url));
const SQLOCAL_DISABLED_STUB = fileURLToPath(new URL('./src/sqlocal-disabled.ts', import.meta.url));

const BLOCKED_DIRS = new Set(['.git', 'node_modules', 'dist', '.vite']);

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const normalizePosix = (value: string): string => value.replace(/\\/g, '/');

const isSubPath = (parent: string, child: string): boolean => {
  const normalizedParent = path.resolve(parent);
  const normalizedChild = path.resolve(child);

  if (normalizedChild === normalizedParent) return true;
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
};

const allowedRoots = (): string[] => {
  const raw = process.env.FS_DEMO_ALLOWED_ROOTS;
  if (!raw || raw.trim().length === 0) {
    return [path.resolve(process.cwd())];
  }

  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
};

const resolveRootPath = (rawRoot: string | null): string => {
  if (!rawRoot || rawRoot.trim().length === 0) {
    throw new ApiError(400, 'Missing root path.');
  }

  const root = path.resolve(rawRoot);
  const allowed = allowedRoots();

  if (!allowed.some((candidate) => isSubPath(candidate, root))) {
    throw new ApiError(
      403,
      `Root path is outside allowed directories. Configure FS_DEMO_ALLOWED_ROOTS to include: ${root}`
    );
  }

  return root;
};

const resolveFilePath = (root: string, filePath: string | null): string => {
  if (!filePath || filePath.trim().length === 0) {
    throw new ApiError(400, 'Missing file path.');
  }

  const cleanPath = normalizePosix(filePath).replace(/^\/+/, '');
  const absolute = path.resolve(root, cleanPath);

  if (!isSubPath(root, absolute)) {
    throw new ApiError(400, `Invalid path outside project root: ${filePath}`);
  }

  return absolute;
};

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
};

const listFilesRecursive = async (root: string): Promise<string[]> => {
  const out: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.DS_Store')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (BLOCKED_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const relative = normalizePosix(path.relative(root, fullPath));
      out.push(relative);
    }
  };

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
};

const handleFsApi = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '/', 'http://localhost');

  if (!url.pathname.startsWith('/api/fs/')) {
    return false;
  }

  try {
    if (url.pathname === '/api/fs/list' && method === 'GET') {
      const root = resolveRootPath(url.searchParams.get('root'));
      const files = await listFilesRecursive(root);
      sendJson(res, 200, { files });
      return true;
    }

    if (url.pathname === '/api/fs/read' && method === 'GET') {
      const root = resolveRootPath(url.searchParams.get('root'));
      const filePath = resolveFilePath(root, url.searchParams.get('path'));

      try {
        const content = await fs.readFile(filePath, 'utf8');
        sendJson(res, 200, { content });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'ENOENT') {
          sendJson(res, 200, { content: null });
        } else {
          throw err;
        }
      }

      return true;
    }

    if (url.pathname === '/api/fs/write' && method === 'POST') {
      const rawBody = await readBody(req);
      const parsed = JSON.parse(rawBody || '{}') as {
        root?: unknown;
        path?: unknown;
        content?: unknown;
      };

      const root = resolveRootPath(typeof parsed.root === 'string' ? parsed.root : null);
      const filePath = resolveFilePath(root, typeof parsed.path === 'string' ? parsed.path : null);
      const content = typeof parsed.content === 'string' ? parsed.content : '';

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: `Unsupported filesystem endpoint: ${method} ${url.pathname}` });
    return true;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      sendJson(res, err.status, { error: err.message });
      return true;
    }

    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
    return true;
  }
};

const fsRoutesPlugin = (): Plugin => {
  return {
    name: 'filesystem-demo-api-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          try {
            const handled = await handleFsApi(req, res);
            if (!handled) next();
          } catch (err: unknown) {
            next(err as Error);
          }
        })();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          try {
            const handled = await handleFsApi(req, res);
            if (!handled) next();
          } catch (err: unknown) {
            next(err as Error);
          }
        })();
      });
    },
  };
};

const opencodeBrowserAliasPlugin = (): Plugin => {
  return {
    name: 'editorts-opencode-browser-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@opencode-ai/sdk') {
        return OPENCODE_BROWSER_STUB;
      }

      if (source === '@opencode-ai/sdk/server') {
        return OPENCODE_SERVER_BROWSER_STUB;
      }

      if (source === './server.js' && importer?.includes('/@opencode-ai/sdk/dist/index.js')) {
        return OPENCODE_SERVER_BROWSER_STUB;
      }

      return null;
    },
  };
};

export default defineConfig({
  base: './',
  plugins: [opencodeBrowserAliasPlugin(), solid(), fsRoutesPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('/typescript/')) {
            return 'vendor-typescript';
          }

          if (id.includes('/modern-monaco/')) {
            return 'vendor-monaco';
          }

          if (id.includes('/@opencode-ai/')) {
            return 'vendor-opencode';
          }

          if (
            id.includes('/@sqlite.org/') ||
            id.includes('sqlite3-worker1-bundler-friendly') ||
            id.includes('sqlite3-opfs-async-proxy')
          ) {
            return 'vendor-sqlite';
          }

          if (id.includes('/solid-js/')) {
            return 'vendor-solid';
          }

          return 'vendor';
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: [
      {
        find: /^@opencode-ai\/sdk$/,
        replacement: OPENCODE_BROWSER_STUB,
      },
      {
        find: /^@opencode-ai\/sdk\/server$/,
        replacement: OPENCODE_SERVER_BROWSER_STUB,
      },
      {
        find: /^sqlocal$/,
        replacement: SQLOCAL_DISABLED_STUB,
      },
    ],
  },
  server: {
    host: 'localhost',
    port: 2050,
    strictPort: true,
  },
});
