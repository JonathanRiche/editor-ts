import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { init } from '../src/core/init';
import type { InitConfig, ToolbarConfig } from '../src/types';

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
  (iframe as unknown as { contentWindow: Window }).contentWindow = {
    postMessage: () => {},
  } as unknown as Window;
  (iframe as unknown as { addEventListener: () => void }).addEventListener = () => {};
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
