import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Database } from 'bun:sqlite';
import { Utils } from 'electrobun/bun';

import type {
  DesktopNativeState,
  DesktopOpenProjectResult,
  DesktopRecentProject,
  DesktopSettingKey,
} from '../shared/desktopRpcSchema';
import {
  getAppStateValue,
  listRecentProjects,
  setAppStateValue,
  upsertRecentProject,
} from './storage';

const BLOCKED_DIRS = new Set(['.git', 'node_modules', 'dist', '.vite']);
const DESKTOP_SETTINGS_KEYS = new Set<DesktopSettingKey>([
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

const resolveRootPath = (rawRoot: string): string => {
  if (!rawRoot || rawRoot.trim().length === 0) {
    throw new Error('Missing root path.');
  }

  return path.resolve(rawRoot);
};

const resolveFilePath = (root: string, filePath: string): string => {
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

type DesktopServiceOptions = {
  db: Database;
  sqlitePath: string;
  userDataPath: string;
};

export const createDesktopService = (options: DesktopServiceOptions) => {
  const { db, sqlitePath, userDataPath } = options;

  const getState = (): DesktopNativeState => {
    return {
      sqlitePath,
      userDataPath,
      recentProjects: listRecentProjects(db) as DesktopRecentProject[],
      settings: {
        aiBaseUrl: getAppStateValue(db, 'aiBaseUrl'),
        aiDirectory: getAppStateValue(db, 'aiDirectory'),
        previewBaseUrl: getAppStateValue(db, 'previewBaseUrl'),
        lastProjectRoot: getAppStateValue(db, 'lastProjectRoot'),
      },
    };
  };

  const setSetting = (input: { key: DesktopSettingKey; value: string }): { ok: true } => {
    if (!DESKTOP_SETTINGS_KEYS.has(input.key)) {
      throw new Error(`Unsupported settings key: ${input.key}`);
    }

    setAppStateValue(db, input.key, input.value);
    return { ok: true };
  };

  const openProject = async (input?: {
    startingFolder?: string;
  }): Promise<DesktopOpenProjectResult> => {
    const startingFolder = typeof input?.startingFolder === 'string' && input.startingFolder.trim().length > 0
      ? input.startingFolder.trim()
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
      return { path: null };
    }

    const label = path.basename(chosen);
    upsertRecentProject(db, chosen, label);
    setAppStateValue(db, 'lastProjectRoot', chosen);

    return {
      path: chosen,
      label,
    };
  };

  const touchRecentProject = (input: {
    path: string;
    label?: string;
  }): { ok: true; path: string; label: string } => {
    const projectPath = input.path.trim();
    if (!projectPath) {
      throw new Error('Missing recent project path.');
    }

    const label = typeof input.label === 'string' && input.label.trim().length > 0
      ? input.label.trim()
      : path.basename(projectPath);

    upsertRecentProject(db, projectPath, label);

    return {
      ok: true,
      path: projectPath,
      label,
    };
  };

  const listProjectFiles = async (input: {
    root: string;
  }): Promise<{ files: string[] }> => {
    const root = resolveRootPath(input.root);
    const files = await listFilesRecursive(root);
    return { files };
  };

  const readProjectFile = async (input: {
    root: string;
    path: string;
  }): Promise<{ content: string | null }> => {
    const root = resolveRootPath(input.root);
    const filePath = resolveFilePath(root, input.path);

    try {
      const content = await readFile(filePath, 'utf8');
      return { content };
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return { content: null };
      }

      throw error;
    }
  };

  const writeProjectFile = async (input: {
    root: string;
    path: string;
    content: string;
  }): Promise<{ ok: true }> => {
    const root = resolveRootPath(input.root);
    const filePath = resolveFilePath(root, input.path);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.content, 'utf8');
    return { ok: true };
  };

  return {
    getState,
    setSetting,
    openProject,
    touchRecentProject,
    listProjectFiles,
    readProjectFile,
    writeProjectFile,
  };
};
