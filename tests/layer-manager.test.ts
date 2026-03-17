import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { LayerManager } from '../core/src/core/LayerManager';
import type { Component } from '../core/src/types';

type MockElement = {
  id?: string;
  className: string;
  textContent: string | null;
  innerHTML: string;
  style: Record<string, string>;
  children: MockElement[];
  dataset: Record<string, string>;
  appendChild: (child: MockElement) => void;
  addEventListener: (event: string, handler: (event?: unknown) => void) => void;
  dispatch: (event: string, payload?: unknown) => void;
  querySelectorAll: (selector: string) => MockElement[];
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  classList: { add: (value: string) => void; remove: (value: string) => void; toggle: (value: string, enabled: boolean) => void; contains: (value: string) => boolean };
};

const createElement = (tag: string): MockElement => {
  const element: MockElement = {
    className: tag,
    textContent: null,
    innerHTML: '',
    style: {},
    children: [],
    dataset: {},
    appendChild: (child) => {
      element.children.push(child);
    },
    addEventListener: (eventName, handler) => {
      element.dataset[eventName] = 'bound';
      element.dataset['handler'] = 'yes';
      (element as unknown as { handlers?: Record<string, (event?: unknown) => void> }).handlers ??= {};
      (element as unknown as { handlers?: Record<string, (event?: unknown) => void> }).handlers![eventName] = handler as (event?: unknown) => void;
    },
    dispatch: (eventName, payload) => {
      const handlers = (element as unknown as { handlers?: Record<string, (event?: unknown) => void> }).handlers;
      handlers?.[eventName]?.(payload);
    },
    querySelectorAll: (selector: string) => {
      const results: MockElement[] = [];
      const needle = selector.replace('.', '');
      const walk = (node: MockElement) => {
        node.children.forEach((child) => {
          if (child.className.includes(needle) || child.dataset['data-id'] || child.dataset['data-parent-id'] || child.dataset['data-index']) {
            results.push(child);
          }
          walk(child);
        });
      };
      walk(element);
      return results;
    },
    setAttribute: (name, value) => {
      element.dataset[name] = value;
    },
    getAttribute: (name) => element.dataset[name] ?? null,
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    },
  };

  return element;
};

describe('LayerManager', () => {
  let originalDocument: typeof document | undefined;

  beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = {
      createElement: (tag: string) => createElement(tag) as unknown as HTMLElement,
      head: {
        appendChild: () => {},
      },
      getElementById: () => null,
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
  it('renders empty state and updates selection', () => {
    const container = createElement('div');
    const manager = new LayerManager({
      container: container as unknown as HTMLElement,
    });

    manager.update([]);
    expect(container.children.length).toBeGreaterThan(0);

    const component: Component = { type: 'box', attributes: { id: 'root' } };
    manager.update([component]);

    manager.setSelected('root');
    expect(container.children.length).toBeGreaterThan(0);
  });

  it('calls onSelect when item clicked', () => {
    const container = createElement('div');
    const selections: string[] = [];
    const manager = new LayerManager({
      container: container as unknown as HTMLElement,
      onSelect: (component) => selections.push(component.attributes?.id ?? ''),
    });

    const component: Component = { type: 'box', attributes: { id: 'root' } };
    manager.update([component]);

    const panel = container.children[0] as unknown as { children?: unknown[] };
    const itemWrapper = panel?.children?.[0] as unknown as { children?: unknown[] };
    const item = itemWrapper?.children?.[0] as unknown as { dispatch?: (eventName: string, payload?: unknown) => void };
    item?.dispatch?.('click');
    item?.dispatch?.('drop', { preventDefault: () => {} });

    expect(selections).toEqual(['root']);
    manager.destroy();
    expect(container.innerHTML).toBe('');
  });
});
