import { describe, expect, it } from 'bun:test';
import { Page } from '../core/src/core/Page';
import type { PageData } from '../core/src/types';

describe('Page', () => {
  const baseData: PageData = {
    title: 'Sample Page',
    item_id: 1,
    body: {
      components: [
        {
          type: 'box',
          tagName: 'div',
          attributes: { id: 'box-1' },
          components: [
            { type: 'text', tagName: 'h1', attributes: { id: 'title' }, content: 'Hello' },
          ],
        },
      ],
      styles: [
        {
          selectors: [{ name: 'box-1' }],
          style: { 'background-color': 'white' },
        },
      ],
      assets: [],
    },
  };

  it('prefers component HTML when components exist', () => {
    const page = new Page(baseData);

    const html = page.getHTML();

    expect(html).toContain('<body>');
    expect(html).toContain('box-1');
    expect(html).toContain('Hello');
  });

  it('returns body-wrapped HTML when body.html is provided', () => {
    const page = new Page({
      ...baseData,
      body: {
        ...baseData.body,
        components: [],
        html: '<div id="root">Text</div>',
      },
    });

    expect(page.getHTML()).toBe('<body><div id="root">Text</div></body>');
  });

  it('synchronizes managers when exporting', () => {
    const page = new Page(baseData);

    page.components.addComponent({ type: 'text', tagName: 'p', attributes: { id: 'p-1' }, content: 'More' });
    page.styles.addStyle({ selectors: [{ name: 'p-1' }], style: { color: 'red' } });
    page.assets.addAsset({
      src: 'https://example.com/asset.png',
      type: 'image',
      unitDim: 'px',
      height: 100,
      width: 200,
    });

    const exported = page.toObject();

    expect(exported.body.components).not.toBeUndefined();
    expect(exported.body.styles).toHaveLength(2);
    expect(exported.body.assets).toHaveLength(1);
  });
});
