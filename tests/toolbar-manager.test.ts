import { describe, expect, it } from 'bun:test';
import { ToolbarManager } from '../core/src/core/ToolbarManager';
import { defaultToolbarConfig } from '../core/src/utils/toolbar';
import type { Component, ToolbarConfig } from '../core/src/types';

describe('ToolbarManager', () => {
  const baseComponent: Component = {
    type: 'box',
    tagName: 'div',
    attributes: { id: 'box-1', 'data-kind': 'hero' },
  };

  const makeConfig = (label: string): ToolbarConfig => ({
    enabled: true,
    actions: [{ id: label, label, icon: 'X', enabled: true }],
  });

  it('applies last-added rule precedence', () => {
    const manager = new ToolbarManager();
    manager.configureByType('box', makeConfig('first'));
    manager.configureByType('box', makeConfig('second'));

    const toolbar = manager.getToolbarForComponent(baseComponent);

    expect(toolbar.actions[0]?.id).toBe('second');
  });

  it('matches selector variants', () => {
    const manager = new ToolbarManager();
    const idConfig = makeConfig('id');
    const attrConfig = makeConfig('attr');

    manager.configureById('box-1', idConfig);
    manager.configure({ attributes: { 'data-kind': 'hero' } }, attrConfig);

    const toolbar = manager.getToolbarForComponent(baseComponent);

    expect(toolbar.actions[0]?.id).toBe('attr');
  });

  it('removes configuration by selector', () => {
    const manager = new ToolbarManager();
    const config = makeConfig('id');

    manager.configureById('box-1', config);
    expect(manager.getToolbarForComponent(baseComponent).actions[0]?.id).toBe('id');

    const removed = manager.removeConfiguration({ id: 'box-1' });
    expect(removed).toBe(true);
    expect(manager.getToolbarForComponent(baseComponent)).toEqual(defaultToolbarConfig);
  });

  it('round-trips config export/import', () => {
    const manager = new ToolbarManager();
    const config = makeConfig('exported');
    manager.configureById('box-1', config);

    const exported = manager.exportConfig();

    const fresh = new ToolbarManager();
    fresh.importConfig(exported);

    expect(fresh.getToolbarForComponent(baseComponent).actions[0]?.id).toBe('exported');
  });
});
