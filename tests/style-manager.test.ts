import { describe, expect, it } from 'bun:test';
import { StyleManager } from '../core/src/core/StyleManager';
import type { PageBody } from '../core/src/types';

describe('StyleManager', () => {
  const body: PageBody = {
    components: [],
    assets: [],
    styles: [
      {
        selectors: [{ name: 'hero' }],
        style: { color: 'blue' },
      },
    ],
  };

  it('finds and updates styles by selector', () => {
    const manager = new StyleManager(structuredClone(body));

    expect(manager.findBySelector('hero')).toHaveLength(1);
    const updated = manager.updateStyle('hero', { color: 'red' });
    expect(updated).toBe(true);
    expect(manager.getStyleProperties('hero')?.color).toBe('red');
  });

  it('compiles styles to CSS', () => {
    const manager = new StyleManager(structuredClone(body));

    manager.addStyle({ selectors: ['.cta'], style: { 'font-weight': '700' } });
    const css = manager.compileToCSS();

    expect(css).toContain('#hero');
    expect(css).toContain('.cta');
    expect(css).toContain('font-weight:700');
  });
});
