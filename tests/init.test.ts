import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { init } from '../core/src/core/init';
import type { ContentAdapter, InitConfig, ToolbarConfig } from '../core/src/types';

type MockIframe = HTMLIFrameElement & { contentWindow: Window };

type MockDocument = {
  body: { innerHTML: string; appendChild: (el: HTMLElement) => void };
  createElement: (tag: string) => HTMLElement;
  getElementById: (id: string) => HTMLElement | null;
  documentElement: HTMLElement;
  addEventListener: () => void;
  removeEventListener: () => void;
};

const createDocument = (): MockDocument => {
  const elements = new Map<string, HTMLElement>();
  const body = {
    innerHTML: '',
    appendChild: (el: HTMLElement) => {
      if (el.id) {
        elements.set(el.id, el);
      }
    },
  };

  const docEl = {
    dataset: {},
    setAttribute: () => {},
  } as unknown as HTMLElement;

  return {
    body,
    documentElement: docEl,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() } as HTMLElement),
    getElementById: (id: string) => elements.get(id) ?? null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
};

const createIframe = (doc: MockDocument, id: string): MockIframe => {
  const iframe = doc.createElement('iframe') as MockIframe;
  iframe.id = id;
  Object.defineProperty(iframe, 'tagName', { value: 'IFRAME' });
  (iframe as unknown as { style: CSSStyleDeclaration }).style = {} as CSSStyleDeclaration;
  (iframe as unknown as { src?: string }).src = '';
  (iframe as unknown as { srcdoc?: string }).srcdoc = '';
  (iframe as unknown as { contentWindow: Window }).contentWindow = {
    postMessage: () => {},
  } as unknown as Window;
  (iframe as unknown as { addEventListener: () => void }).addEventListener = () => {};
  (iframe as unknown as { removeAttribute: (name: string) => void }).removeAttribute = (name: string) => {
    if (name === 'src') {
      (iframe as unknown as { src?: string }).src = '';
    }
    if (name === 'srcdoc') {
      (iframe as unknown as { srcdoc?: string }).srcdoc = '';
    }
  };
  doc.body.appendChild(iframe as unknown as HTMLElement);
  return iframe;
};

describe('init', () => {
  let mockDocument: MockDocument;
  let originalDocument: typeof document | undefined;
  let originalWindow: typeof window | undefined;

  beforeEach(() => {
    mockDocument = createDocument();
    originalDocument = globalThis.document;
    originalWindow = globalThis.window;
    globalThis.document = mockDocument as unknown as Document;
    globalThis.window = {
      location: { origin: 'http://localhost:5021' },
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      },
    } as unknown as Window & typeof globalThis;
  });

  it('throws when multipage data is empty', () => {
    createIframe(mockDocument, 'preview');

    const config: InitConfig = {
      iframeId: 'preview',
      data: { pages: [], activePageIndex: 0 },
    };

    expect(() => init(config)).toThrow('MultiPageData.pages cannot be empty');
  });

  it('applies toolbar configuration by id and default', () => {
    createIframe(mockDocument, 'toolbar-frame');

    const defaultToolbar: ToolbarConfig = {
      enabled: true,
      actions: [{ id: 'default', label: 'Default', icon: 'D', enabled: true }],
    };

    const config: InitConfig = {
      iframeId: 'toolbar-frame',
      data: {
        title: 'Toolbar page',
        item_id: 1,
        body: {
          components: [
            { type: 'box', attributes: { id: 'root' } },
          ],
          styles: [],
          assets: [],
        },
      },
      toolbars: {
        default: defaultToolbar,
        byId: {
          root: {
            enabled: true,
            actions: [{ id: 'root-action', label: 'Root', icon: 'R', enabled: true }],
          },
        },
      },
    };

    const editor = init(config);

    const component = editor.page.components.findById('root');
    expect(component).not.toBeNull();

    const toolbar = editor.page.toolbars.getToolbarForComponent(component!);
    expect(toolbar.actions[0]?.id).toBe('root-action');

    const missingToolbar = editor.page.toolbars.getToolbarForComponent({ type: 'text' });
    expect(missingToolbar.actions[0]?.id).toBe('default');
  });

  it('accepts content adapter without data and exposes content API', async () => {
    createIframe(mockDocument, 'adapter-frame');

    let saveCount = 0;
    let loadCount = 0;
    let describeCount = 0;
    let aiWorkspaceCount = 0;

    const adapter: ContentAdapter = {
      id: 'mock',
      mode: 'json',
      capabilities: {
        writable: true,
        supportsFileTree: true,
      },
      load: async () => {
        loadCount += 1;
        return {
          data: {
            title: 'Loaded from adapter',
            item_id: 12,
            body: {
              components: [],
              styles: [],
              assets: [],
            },
          },
        };
      },
      save: async () => {
        saveCount += 1;
      },
      listFiles: async () => [{ path: 'page.json', language: 'json' }],
      readFile: async () => '{"title":"Loaded from adapter"}',
      writeFile: async () => {
        return;
      },
      describeWorkspace: async () => {
        describeCount += 1;
        return {
          kind: 'json-page',
          runtime: 'page',
          entryPaths: ['page.json'],
          stylePaths: ['styles.css'],
          dataPaths: ['page.json'],
          scriptPaths: [],
        };
      },
      buildAiWorkspace: async () => {
        aiWorkspaceCount += 1;
        return {
          files: { 'page.json': '{"title":"Loaded from adapter"}' },
          editablePaths: ['page.json'],
          readOnlyPaths: [],
          mode: 'canonical',
        };
      },
      describePreview: async () => ({
        mode: 'page-srcdoc',
        kind: 'json-page',
        runtime: 'page',
        routes: [],
      }),
    };

    const editor = init({
      iframeId: 'adapter-frame',
      content: { adapter },
    });

    expect(editor.content.adapter).toBe(adapter);

    await editor.content.save();
    await editor.content.load();
    const workspace = await editor.content.describeWorkspace();
    const aiWorkspace = await editor.content.buildAiWorkspace();
    const preview = await editor.content.describePreview();

    expect(saveCount).toBeGreaterThan(0);
    expect(loadCount).toBeGreaterThan(0);
    expect(describeCount).toBe(1);
    expect(aiWorkspaceCount).toBe(1);
    expect(workspace?.kind).toBe('json-page');
    expect(aiWorkspace?.mode).toBe('canonical');
    expect(preview?.mode).toBe('page-srcdoc');
  });

  it('switches the iframe to app-url preview and supports route navigation', async () => {
    const iframe = createIframe(mockDocument, 'app-preview');

    const editor = init({
      iframeId: 'app-preview',
      content: {
        adapter: {
          id: 'app-preview-adapter',
          capabilities: {
            supportsPreviewDescription: true,
          },
          load: async () => ({
            data: {
              title: 'App preview',
              item_id: 1,
              body: {
                components: [],
                styles: [],
                assets: [],
              },
            },
          }),
          save: async () => undefined,
          listFiles: async () => [],
          readFile: async () => null,
          writeFile: async () => undefined,
          describePreview: async () => ({
            mode: 'app-url',
            kind: 'vite-solid',
            runtime: 'app',
            baseUrl: 'http://localhost:4173',
            activePath: '/',
            routes: [
              { path: '/', label: 'Home' },
              { path: '/pricing', label: 'Pricing' },
            ],
          }),
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((iframe as unknown as { src?: string }).src).toBe('http://localhost:4173/');
    expect(editor.preview.currentPath()).toBe('/');

    await editor.preview.navigate('/pricing');

    expect((iframe as unknown as { src?: string }).src).toBe('http://localhost:4173/pricing');
    expect(editor.preview.currentPath()).toBe('/pricing');
  });

  afterEach(() => {
    if (typeof originalDocument !== 'undefined') {
      globalThis.document = originalDocument;
    } else {
      // @ts-expect-error cleanup
      delete globalThis.document;
    }
    if (typeof originalWindow !== 'undefined') {
      globalThis.window = originalWindow;
    } else {
      // @ts-expect-error cleanup
      delete globalThis.window;
    }
  });
});
