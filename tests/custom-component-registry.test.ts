import { describe, expect, it } from 'bun:test';
import { defaultComponentFactories, mergeCustomComponentRegistry } from '../core/src/core/CustomComponentRegistry';
import type { CustomComponentRegistry } from '../core/src/types';

describe('CustomComponentRegistry', () => {
  it('merges custom registries with overrides', () => {
    const base: CustomComponentRegistry = {
      hero: { type: 'hero', factory: () => ({ type: 'hero', attributes: { id: 'hero-1' } }) },
    };
    const overrides: CustomComponentRegistry = {
      hero: { type: 'hero', factory: () => ({ type: 'hero', attributes: { id: 'hero-2' } }) },
    };

    const merged = mergeCustomComponentRegistry(base, overrides);

    expect(merged.hero?.factory().attributes?.id).toBe('hero-2');
  });

  it('builds default image factory with placeholder src', () => {
    const image = defaultComponentFactories.image();
    const src = image.attributes?.src ?? '';

    expect(image.tagName).toBe('img');
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
  });
});
