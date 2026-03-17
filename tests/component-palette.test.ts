import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ComponentPalette } from '../core/src/core/ComponentPalette';
import type { CustomComponentRegistry } from '../core/src/types';

type MockElement = {
  id?: string;
  textContent: string | null;
  innerHTML: string;
  style: Record<string, string>;
  children: MockElement[];
  dataset: Record<string, string>;
  className: string;
  type?: string;
  appendChild: (child: MockElement) => void;
  addEventListener: (event: string, handler: () => void) => void;
  click: () => void;
};

const createElement = (tagName: string): MockElement => {
  const element: MockElement = {
    textContent: null,
    innerHTML: '',
    style: {},
    children: [],
    dataset: {},
    className: tagName,
    appendChild: (child) => {
      element.children.push(child);
      element.textContent = element.children
        .map((entry) => entry.textContent ?? '')
        .join('');
    },
    addEventListener: (_event, handler) => {
      element.click = handler;
    },
    click: () => {},
  };
  return element;
};

describe('ComponentPalette', () => {
  let originalDocument: typeof document | undefined;

  beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = {
      createElement: (tag: string) => createElement(tag) as unknown as HTMLElement,
      getElementById: () => null,
      head: {
        appendChild: () => {},
      },
    } as unknown as Document;
  });

  afterEach(() => {
    if (typeof originalDocument !== 'undefined') {
      globalThis.document = originalDocument;
    } else {
      // @ts-expect-error cleanup
      delete globalThis.document;
    }
  });
  it('renders empty state and selection', () => {
    const container = createElement('div');
    const registry: CustomComponentRegistry = {
      box: {
        type: 'box',
        label: 'Box',
        factory: () => ({ type: 'box', attributes: { id: 'box-1' } }),
      },
    };

    const palette = new ComponentPalette({
      container: container as unknown as HTMLElement,
      registry: {},
      onPick: () => {},
    });

    expect(container.textContent).toBe('No components available');

    palette.updateRegistry(registry);
    palette.setSelected('box');

    expect(container.children.length).toBeGreaterThan(0);
  });

  it('fires onPick when clicking a component', () => {
    const container = createElement('div');
    const registry: CustomComponentRegistry = {
      box: {
        type: 'box',
        label: 'Box',
        factory: () => ({ type: 'box', attributes: { id: 'box-1' } }),
      },
    };

    const picks: string[] = [];
    const palette = new ComponentPalette({
      container: container as unknown as HTMLElement,
      registry,
      onPick: (type) => picks.push(type),
    });

    const button = container.children[0]?.children[0];
    button?.click();

    expect(picks).toEqual(['box']);
    palette.destroy();
    expect(container.innerHTML).toBe('');
  });
});
