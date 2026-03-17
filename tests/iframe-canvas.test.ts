import { describe, expect, it } from 'bun:test';
import { buildIframeCanvasSrcdoc, buildIframeCanvasSrcdocFromPage } from '../core/src/core/iframeCanvas';
import { Page } from '../core/src/core/Page';
import type { PageData } from '../core/src/types';

describe('iframeCanvas', () => {
  it('builds srcdoc with title, css, and html', () => {
    const srcdoc = buildIframeCanvasSrcdoc({
      title: 'Canvas Title',
      css: 'body { background: #fff; }',
      htmlBody: '<body><div id="root">Hi</div></body>',
    });

    expect(srcdoc).toContain('<title>Canvas Title</title>');
    expect(srcdoc).toContain('background: #fff');
    expect(srcdoc).toContain('<div id="root">Hi</div>');
    expect(srcdoc).toContain('editorts-highlight');
  });

  it('builds srcdoc from Page instance', () => {
    const data: PageData = {
      title: 'Doc Page',
      item_id: 1,
      body: {
        components: [
          { type: 'box', attributes: { id: 'root' }, components: [
            { type: 'text', tagName: 'p', attributes: { id: 'text' }, content: 'Hello' },
          ] },
        ],
        styles: [
          { selectors: [{ name: 'root' }], style: { color: 'red' } },
        ],
        assets: [],
      },
    };

    const page = new Page(data);
    const srcdoc = buildIframeCanvasSrcdocFromPage(page);

    expect(srcdoc).toContain('Doc Page');
    expect(srcdoc).toContain('id="root"');
    expect(srcdoc).toContain('Hello');
  });
});
