import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { Database } from 'bun:sqlite';
import { Utils } from 'electrobun/bun';

type DesktopAppState = {
  sqlitePath: string;
  userDataPath: string;
};

type RecentProjectRow = {
  path: string;
  label: string | null;
  opened_at: number;
};

const ensureDirectory = (target: string): void => {
  mkdirSync(target, { recursive: true });
};

const createTables = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recent_projects (
      path TEXT PRIMARY KEY,
      label TEXT,
      opened_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
};

export const openDesktopDatabase = (): DesktopAppState & { db: Database } => {
  const userDataPath = Utils.paths.userData;
  ensureDirectory(userDataPath);

  const sqlitePath = path.join(userDataPath, 'editorts-desktop.sqlite');
  const db = new Database(sqlitePath, { create: true });
  createTables(db);

  return {
    db,
    sqlitePath,
    userDataPath,
  };
};

export const upsertRecentProject = (db: Database, projectPath: string, label?: string): void => {
  db.run(
    `
      INSERT INTO recent_projects (path, label, opened_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(path) DO UPDATE SET
        label = excluded.label,
        opened_at = unixepoch()
    `,
    [projectPath, label ?? null],
  );
};

export const listRecentProjects = (
  db: Database,
): Array<{ path: string; label?: string; openedAt: number }> => {
  const rows = db
    .query(
      `
        SELECT path, label, opened_at
        FROM recent_projects
        ORDER BY opened_at DESC
        LIMIT 20
      `,
    )
    .all() as RecentProjectRow[];

  return rows.map((row) => ({
    path: row.path,
    label: row.label ?? undefined,
    openedAt: row.opened_at,
  }));
};

export const getAppStateValue = (db: Database, key: string): string | null => {
  const row = db
    .query(
      `
        SELECT value
        FROM app_state
        WHERE key = ?
      `,
    )
    .get(key) as { value?: string } | null;

  return typeof row?.value === 'string' ? row.value : null;
};

export const setAppStateValue = (db: Database, key: string, value: string): void => {
  db.run(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = unixepoch()
    `,
    [key, value],
  );
};
