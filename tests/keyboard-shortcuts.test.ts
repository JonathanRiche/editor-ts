import { afterAll, describe, expect, it } from 'bun:test';
import { KeyboardShortcuts } from '../core/src/core/KeyboardShortcuts';
import type { ShortcutDefinition } from '../core/src/types';

const OriginalHTMLElement = globalThis.HTMLElement;
class MockHTMLElement {
  tagName: string;
  isContentEditable = false;

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }
}

globalThis.HTMLElement = MockHTMLElement as unknown as typeof HTMLElement;

afterAll(() => {
  if (OriginalHTMLElement) {
    globalThis.HTMLElement = OriginalHTMLElement;
  }
});

type KeyEventInit = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
};

const createKeyboardEvent = (init: KeyEventInit): KeyboardEvent => {
  const event = {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    target: init.target ?? null,
    preventDefault: () => {
      preventDefault.called = true;
    },
  } as unknown as KeyboardEvent;

  const preventDefault = event.preventDefault as (() => void) & { called?: boolean };
  preventDefault.called = false;

  return event;
};

type Listener = (event: KeyboardEvent) => void;

const createDoc = () => {
  let listener: Listener | null = null;
  return {
    addEventListener: (_type: string, cb: Listener) => {
      listener = cb;
    },
    removeEventListener: () => {
      listener = null;
    },
    dispatch: (event: KeyboardEvent) => {
      listener?.(event);
    },
  } as unknown as Document & { dispatch: (event: KeyboardEvent) => void };
};

describe('KeyboardShortcuts', () => {
  it('triggers shortcuts with mod key', () => {
    const actions: string[] = [];
    const shortcuts: ShortcutDefinition[] = [
      { key: 'mod+p', action: () => { actions.push('palette'); } },
    ];

    const doc = createDoc();
    const handler = new KeyboardShortcuts({ shortcuts, modKey: 'ctrl' });
    handler.bind(doc);

    const event = createKeyboardEvent({ key: 'p', ctrlKey: true });
    doc.dispatch(event);

    expect(actions).toEqual(['palette']);
    expect((event.preventDefault as typeof event.preventDefault & { called?: boolean }).called).toBe(true);
  });

  it('ignores input targets when no modifier is pressed', () => {
    const actions: string[] = [];
    const shortcuts: ShortcutDefinition[] = [
      { key: 'delete', action: () => { actions.push('delete'); } },
    ];

    const doc = createDoc();
    const handler = new KeyboardShortcuts({ shortcuts });
    handler.bind(doc);

    const input = new MockHTMLElement('INPUT') as unknown as HTMLElement;
    const event = createKeyboardEvent({ key: 'delete', target: input });
    doc.dispatch(event);

    expect(actions).toEqual([]);
    expect((event.preventDefault as typeof event.preventDefault & { called?: boolean }).called).toBe(false);
  });

  it('unbind removes listeners', () => {
    const actions: string[] = [];
    const shortcuts: ShortcutDefinition[] = [
      { key: 'mod+p', action: () => { actions.push('palette'); } },
    ];

    const doc = createDoc();
    const handler = new KeyboardShortcuts({ shortcuts, modKey: 'ctrl' });
    handler.bind(doc);
    handler.unbind(doc);

    doc.dispatch(createKeyboardEvent({ key: 'p', ctrlKey: true }));

    expect(actions).toEqual([]);
  });
});
