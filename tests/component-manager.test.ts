import { describe, expect, it } from 'bun:test';
import { ComponentManager } from '../core/src/core/ComponentManager';
import type { Component, PageBody } from '../core/src/types';

describe('ComponentManager', () => {
  const makeBody = (components: Component[]): PageBody => ({
    components,
    assets: [],
    styles: [],
  });

  it('finds components by id, type, and tagName', () => {
    const manager = new ComponentManager(
      makeBody([
        {
          type: 'box',
          tagName: 'section',
          attributes: { id: 'root' },
          components: [
            { type: 'text', tagName: 'h2', attributes: { id: 'title' }, content: 'Hello' },
          ],
        },
      ])
    );

    expect(manager.findById('root')?.tagName).toBe('section');
    expect(manager.findByType('text')).toHaveLength(1);
    expect(manager.findByTagName('h2')).toHaveLength(1);
  });

  it('adds, updates, removes, and moves components', () => {
    const manager = new ComponentManager(makeBody([{ type: 'box', attributes: { id: 'root' } }]));

    manager.addComponent({ type: 'text', tagName: 'p', attributes: { id: 'intro' }, content: 'Hi' });
    expect(manager.findById('intro')?.content).toBe('Hi');

    manager.updateTextContent('intro', 'Updated');
    expect(manager.findById('intro')?.content).toBe('Updated');

    manager.addChildComponent('root', { type: 'text', tagName: 'span', attributes: { id: 'child' }, content: 'Child' });
    expect(manager.findById('child')).not.toBeNull();

    const moved = manager.moveComponent('child', null, 0);
    expect(moved).toBe(true);
    expect(manager.getParentAndIndex('child')?.parentId).toBeNull();

    const removed = manager.removeComponent('intro');
    expect(removed).toBe(true);
    expect(manager.findById('intro')).toBeNull();
  });
});
