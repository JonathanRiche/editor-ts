import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database } from 'bun:sqlite';
import { Utils } from 'electrobun/bun';

import type {
  DesktopNativeState,
  DesktopOpenProjectResult,
  DesktopRecentProject,
  DesktopSettingKey,
} from '../shared/desktopRpcSchema';
import {
  deleteEditorPageValue,
  getEditorPageValue,
  getAppStateValue,
  listRecentProjects,
  setEditorPageValue,
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

const pickerDebugEnabled = (): boolean => {
  return process.env.EDITORTS_DESKTOP_RPC_DEBUG === '1';
};

const shouldPreferPortalPicker = (): boolean => {
  return process.env.EDITORTS_DESKTOP_USE_PORTAL === '1';
};

const ensureDirectoryHint = (value: string): string => {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
};

const runCommand = async (cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn(cmd, {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
};

const runShellCommand = async (script: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  return runCommand(['bash', '-lc', script]);
};

const canRunCommand = async (command: string): Promise<boolean> => {
  const result = await runShellCommand(`command -v ${command}`);
  return result.exitCode === 0;
};

const decodeFileUri = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('file://')) {
    return null;
  }

  try {
    return fileURLToPath(trimmed);
  } catch {
    return null;
  }
};

const pickDirectoryWithPortal = async (): Promise<string | null> => {
  const script = `
set -euo pipefail
token="editorts$RANDOM$RANDOM"
request=$(gdbus call --session \
  --dest org.freedesktop.portal.Desktop \
  --object-path /org/freedesktop/portal/desktop \
  --method org.freedesktop.portal.FileChooser.OpenFile \
  '' \
  'Select Project Folder' \
  "{'handle_token': <'$token'>, 'directory': <true>, 'multiple': <false>, 'modal': <true>}" \
  2>/dev/null | sed -n "s/^(objectpath '\\([^']*\\)'.*/\\1/p")
[ -n "$request" ] || exit 1
timeout 300 gdbus monitor --session \
  --dest org.freedesktop.portal.Desktop \
  --object-path "$request" \
  2>/dev/null | sed -n "/org\\.freedesktop\\.portal\\.Request\\.Response/{
    s/.*'uris': <\\[\\([^]]*\\)\\]>.*/\\1/p
    q
  }" | tr -d "'" | cut -d, -f1
`;

  const result = await runShellCommand(script);
  if (result.exitCode !== 0) {
    return null;
  }

  return decodeFileUri(result.stdout) ?? null;
};

const pickDirectoryWithZenity = async (startingFolder: string): Promise<string | null> => {
  const result = await runCommand([
    'zenity',
    '--file-selection',
    '--directory',
    '--title=Select Project Folder',
    `--filename=${ensureDirectoryHint(startingFolder)}`,
  ]);

  if (result.exitCode !== 0) {
    return null;
  }

  const chosen = result.stdout.trim();
  return chosen.length > 0 ? chosen : null;
};

const pickDirectoryWithKDialog = async (startingFolder: string): Promise<string | null> => {
  const result = await runCommand([
    'kdialog',
    '--getexistingdirectory',
    startingFolder,
    '--title',
    'Select Project Folder',
  ]);

  if (result.exitCode !== 0) {
    return null;
  }

  const chosen = result.stdout.trim();
  return chosen.length > 0 ? chosen : null;
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
    const requestedStartingFolder = typeof input?.startingFolder === 'string' && input.startingFolder.trim().length > 0
      ? input.startingFolder.trim()
      : null;
    const storedProjectRoot = getAppStateValue(db, 'lastProjectRoot')?.trim() || null;
    const startingFolder = requestedStartingFolder
      ?? storedProjectRoot
      ?? homedir();

    let chosen: string | null = null;

    if (process.platform === 'linux') {
      if (shouldPreferPortalPicker() && await canRunCommand('gdbus')) {
        if (pickerDebugEnabled()) {
          console.log(`[desktop-picker] trying xdg-portal from ${startingFolder}`);
        }
        chosen = await pickDirectoryWithPortal();
      }

      if (!chosen && await canRunCommand('kdialog')) {
        if (pickerDebugEnabled()) {
          console.log(`[desktop-picker] trying kdialog from ${startingFolder}`);
        }
        chosen = await pickDirectoryWithKDialog(startingFolder);
      }

      if (!chosen && await canRunCommand('zenity')) {
        if (pickerDebugEnabled()) {
          console.log(`[desktop-picker] trying zenity from ${startingFolder}`);
        }
        chosen = await pickDirectoryWithZenity(startingFolder);
      }

      if (!chosen && !shouldPreferPortalPicker() && await canRunCommand('gdbus')) {
        if (pickerDebugEnabled()) {
          console.log(`[desktop-picker] trying xdg-portal fallback from ${startingFolder}`);
        }
        chosen = await pickDirectoryWithPortal();
      }
    }

    if (!chosen) {
      if (pickerDebugEnabled()) {
        console.log(`[desktop-picker] falling back to electrobun dialog from ${startingFolder}`);
      }
      const dialogOptions = {
        allowedFileTypes: '*',
        canChooseFiles: false,
        canChooseDirectory: true,
        allowsMultipleSelection: false,
        startingFolder,
      };

      const chosenPaths = await Utils.openFileDialog(dialogOptions);
      chosen = Array.isArray(chosenPaths) && typeof chosenPaths[0] === 'string'
        ? chosenPaths[0]
        : null;
    }

    if (pickerDebugEnabled()) {
      console.log(`[desktop-picker] result ${chosen ?? '<cancelled>'}`);
    }

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

  const loadDesktopStoragePage = (input: {
    key: string;
  }): { value: string | null } => {
    const key = input.key.trim();
    if (!key) {
      throw new Error('Missing desktop storage key.');
    }

    return {
      value: getEditorPageValue(db, key),
    };
  };

  const saveDesktopStoragePage = (input: {
    key: string;
    value: string;
  }): { ok: true } => {
    const key = input.key.trim();
    if (!key) {
      throw new Error('Missing desktop storage key.');
    }

    setEditorPageValue(db, key, input.value);
    return { ok: true };
  };

  const deleteDesktopStoragePage = (input: {
    key: string;
  }): { ok: true } => {
    const key = input.key.trim();
    if (!key) {
      throw new Error('Missing desktop storage key.');
    }

    deleteEditorPageValue(db, key);
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
    loadDesktopStoragePage,
    saveDesktopStoragePage,
    deleteDesktopStoragePage,
  };
};
