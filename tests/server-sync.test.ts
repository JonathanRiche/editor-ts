import { describe, expect, it } from 'bun:test';
import { createPageMeta, createSyncMessage, isSyncAck, isSyncMessage, parseSyncEnvelope } from '../core/src/server/sync';
import type { PageData } from '../core/src/types';

describe('server sync helpers', () => {
  const pageData: PageData = {
    title: 'Test page',
    item_id: 42,
    body: {
      components: [],
      assets: [],
      styles: [],
    },
  };

  it('creates page metadata from PageData', () => {
    const meta = createPageMeta('page-key', pageData, { updatedAt: '2026-01-16T00:00:00.000Z' });

    expect(meta.key).toBe('page-key');
    expect(meta.title).toBe('Test page');
    expect(meta.itemId).toBe(42);
    expect(meta.updatedAt).toBe('2026-01-16T00:00:00.000Z');
  });

  it('round-trips sync envelopes', () => {
    const message = createSyncMessage(pageData, { key: 'page-key' });
    const raw = JSON.stringify(message);
    const parsed = parseSyncEnvelope(raw);

    expect(parsed).not.toBeNull();
    expect(parsed && isSyncMessage(parsed)).toBe(true);
    expect(parsed && isSyncAck(parsed)).toBe(false);
  });
});
