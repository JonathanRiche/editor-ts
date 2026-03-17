import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Database } from 'bun:sqlite';
import { Utils } from 'electrobun/bun';

import {
  getAppStateValue,
  listRecentProjects,
  setAppStateValue,
  upsertRecentProject,
} from './storage';

const BLOCKED_DIRS = new Set(['.git', 'node_modules', 'dist', '.vite']);
const DESKTOP_SETTINGS_KEYS = new Set([
  'aiBaseUrl',
  'aiDirectory',
  'previewBaseUrl',
  'lastProjectRoot',
]);

const normalizePosix = (value: string): string => value.replace(/\\/g, '/');

const isSubPath = (parent: string, child: string): boolean => {
  const normalizedParent = path.resolve(parent);
  const normalizedChild = path.resolve(child);

  if (normalizedChild === normalizedParent) return true;
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
};

const jsonResponse = (payload: unknown, status = 200): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
};

const emptyResponse = (): Response => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
};

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text();
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
};

const listFilesRecursive = async (root: string): Promise<string[]> => {
  const out: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.DS_Store')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (BLOCKED_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      out.push(normalizePosix(path.relative(root, fullPath)));
    }
  };

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
};

const resolveRootPath = (rawRoot: string | null): string => {
  if (!rawRoot || rawRoot.trim().length === 0) {
    throw new Error('Missing root path.');
  }

  return path.resolve(rawRoot);
};

const resolveFilePath = (root: string, filePath: string | null): string => {
  if (!filePath || filePath.trim().length === 0) {
    throw new Error('Missing file path.');
  }

  const cleanPath = normalizePosix(filePath).replace(/^\/+/, '');
  const absolute = path.resolve(root, cleanPath);

  if (!isSubPath(root, absolute)) {
    throw new Error(`Invalid path outside project root: ${filePath}`);
  }

  return absolute;
};

type DesktopServerOptions = {
  db: Database;
  sqlitePath: string;
  userDataPath: string;
};

export const startDesktopApiServer = (options: DesktopServerOptions) => {
  const { db, sqlitePath, userDataPath } = options;

  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return emptyResponse();
      }

      try {
        if (url.pathname === '/api/desktop/state' && request.method === 'GET') {
          return jsonResponse({
            sqlitePath,
            userDataPath,
            recentProjects: listRecentProjects(db),
            settings: {
              aiBaseUrl: getAppStateValue(db, 'aiBaseUrl'),
              aiDirectory: getAppStateValue(db, 'aiDirectory'),
              previewBaseUrl: getAppStateValue(db, 'previewBaseUrl'),
              lastProjectRoot: getAppStateValue(db, 'lastProjectRoot'),
            },
          });
        }

        if (url.pathname === '/api/desktop/settings' && request.method === 'POST') {
          const body = await readJsonBody(request);
          const key = typeof body.key === 'string' ? body.key.trim() : '';
          const value = typeof body.value === 'string' ? body.value : '';

          if (!DESKTOP_SETTINGS_KEYS.has(key)) {
            return jsonResponse({ error: `Unsupported settings key: ${key}` }, 400);
          }

          setAppStateValue(db, key, value);
          return jsonResponse({ ok: true });
        }

        if (url.pathname === '/api/desktop/open-project' && request.method === 'POST') {
          const body = await readJsonBody(request);
          const startingFolder = typeof body.startingFolder === 'string' && body.startingFolder.trim()
            ? body.startingFolder.trim()
            : undefined;

          const chosenPaths = await Utils.openFileDialog({
            startingFolder,
            allowedFileTypes: '*',
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          });

          const chosen = Array.isArray(chosenPaths) && typeof chosenPaths[0] === 'string'
            ? chosenPaths[0]
            : null;

          if (!chosen) {
            return jsonResponse({ path: null });
          }

          upsertRecentProject(db, chosen, path.basename(chosen));
          setAppStateValue(db, 'lastProjectRoot', chosen);
          return jsonResponse({
            path: chosen,
            label: path.basename(chosen),
          });
        }

        if (url.pathname === '/api/desktop/recent-project' && request.method === 'POST') {
          const body = await readJsonBody(request);
          const projectPath = typeof body.path === 'string' ? body.path.trim() : '';
          if (!projectPath) {
            return jsonResponse({ error: 'Missing recent project path.' }, 400);
          }

          const label = typeof body.label === 'string' && body.label.trim().length > 0
            ? body.label.trim()
            : path.basename(projectPath);

          upsertRecentProject(db, projectPath, label);
          return jsonResponse({
            ok: true,
            path: projectPath,
            label,
          });
        }

        if (url.pathname === '/api/fs/list' && request.method === 'GET') {
          const root = resolveRootPath(url.searchParams.get('root'));
          const files = await listFilesRecursive(root);
          return jsonResponse({ files });
        }

        if (url.pathname === '/api/fs/read' && request.method === 'GET') {
          const root = resolveRootPath(url.searchParams.get('root'));
          const filePath = resolveFilePath(root, url.searchParams.get('path'));

          try {
            const content = await readFile(filePath, 'utf8');
            return jsonResponse({ content });
          } catch (error: unknown) {
            if ((error as { code?: string }).code === 'ENOENT') {
              return jsonResponse({ content: null });
            }

            throw error;
          }
        }

        if (url.pathname === '/api/fs/write' && request.method === 'POST') {
          const body = await readJsonBody(request);
          const root = resolveRootPath(typeof body.root === 'string' ? body.root : null);
          const filePath = resolveFilePath(root, typeof body.path === 'string' ? body.path : null);
          const content = typeof body.content === 'string' ? body.content : '';

          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, content, 'utf8');
          return jsonResponse({ ok: true });
        }

        return jsonResponse({ error: `Unsupported endpoint: ${request.method} ${url.pathname}` }, 404);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: message }, 500);
      }
    },
  });

  return server;
};
