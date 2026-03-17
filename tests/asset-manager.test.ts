import { describe, expect, it } from 'bun:test';
import { AssetManager } from '../core/src/core/AssetManager';
import type { Asset, PageBody } from '../core/src/types';

describe('AssetManager', () => {
  const makeAsset = (overrides: Partial<Asset> = {}): Asset => ({
    type: 'image',
    src: 'https://example.com/hero.png',
    unitDim: 'px',
    height: 100,
    width: 200,
    ...overrides,
  });

  it('finds and updates assets', () => {
    const body: PageBody = {
      components: [],
      styles: [],
      assets: [makeAsset(), makeAsset({ type: 'video', src: 'https://example.com/clip.mp4' })],
    };

    const manager = new AssetManager(body);

    expect(manager.findByType('image')).toHaveLength(1);
    expect(manager.findBySource('clip')).toHaveLength(1);
    expect(manager.findByExactSource('https://example.com/hero.png')).not.toBeNull();

    const updated = manager.updateAsset('https://example.com/hero.png', { width: 300 });
    expect(updated).toBe(true);
    expect(manager.getAll()[0]?.width).toBe(300);
  });

  it('adds and removes assets', () => {
    const body: PageBody = { components: [], styles: [], assets: [] };
    const manager = new AssetManager(body);

    manager.addAsset(makeAsset({ src: 'https://example.com/new.png' }));
    expect(manager.count()).toBe(1);

    const removed = manager.removeAsset('https://example.com/new.png');
    expect(removed).toBe(true);
    expect(manager.count()).toBe(0);
  });

  it('syncs assets back to page body', () => {
    const body: PageBody = { components: [], styles: [], assets: [] };
    const manager = new AssetManager(body);

    manager.addAsset(makeAsset({ src: 'https://example.com/sync.png' }));
    manager.sync();

    expect(body.assets).toHaveLength(1);
    expect(body.assets?.[0]?.src).toBe('https://example.com/sync.png');
  });
});
