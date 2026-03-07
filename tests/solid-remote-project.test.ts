import { beforeEach, describe, expect, it } from 'bun:test';

import {
  REMOTE_PROJECT_FILES_PREFIX,
  handleRemoteProjectRequest,
} from '../examples/solid/src/remoteProject';

const clearStore = () => {
  const host = globalThis as typeof globalThis & {
    __editortsRemoteProjectStore?: Map<string, unknown>;
  };
  host.__editortsRemoteProjectStore = undefined;
};

describe('solid remote project API', () => {
  beforeEach(() => {
    clearStore();
  });

  it('lists seeded remote files', async () => {
    const response = await handleRemoteProjectRequest(new Request(`http://demo.local${REMOTE_PROJECT_FILES_PREFIX}`));
    const payload = await response?.json() as { files?: Array<{ path: string }> };

    expect(response?.status).toBe(200);
    expect(payload.files?.some((file) => file.path === 'page.json')).toBe(true);
    expect(payload.files?.some((file) => file.path === 'remote-workspace.md')).toBe(true);
  });

  it('writes and reads page.json through the API', async () => {
    const nextPage = JSON.stringify({ title: 'Remote API Test' }, null, 2);

    const write = await handleRemoteProjectRequest(new Request(`http://demo.local${REMOTE_PROJECT_FILES_PREFIX}/page.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: nextPage }),
    }));

    const read = await handleRemoteProjectRequest(new Request(`http://demo.local${REMOTE_PROJECT_FILES_PREFIX}/page.json`));
    const payload = await read?.json() as { content?: string };

    expect(write?.status).toBe(200);
    expect(payload.content).toBe(nextPage);
  });

  it('rejects writes to read-only files', async () => {
    const response = await handleRemoteProjectRequest(new Request(`http://demo.local${REMOTE_PROJECT_FILES_PREFIX}/remote-workspace.md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'nope' }),
    }));

    expect(response?.status).toBe(403);
  });
});
