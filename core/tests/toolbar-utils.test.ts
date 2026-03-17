import { describe, expect, it } from 'bun:test';
import { createToolbarConfig, findToolbarAction, getEnabledActions, mergeToolbarConfigs, toolbarPresets } from '../src/utils/toolbar';
import type { ToolbarConfig } from '../src/types';

describe('toolbar utils', () => {
  it('merges toolbar configs with override precedence', () => {
    const base: ToolbarConfig = createToolbarConfig([
      { id: 'edit', label: 'Edit', icon: 'E', enabled: true },
    ]);

    const merged = mergeToolbarConfigs(base, {
      enabled: false,
      actions: [{ id: 'delete', label: 'Delete', icon: 'D', enabled: true }],
    });

    expect(merged.enabled).toBe(false);
    expect(merged.actions[0]?.id).toBe('delete');
  });

  it('filters enabled actions and finds actions by id', () => {
    const config = createToolbarConfig([
      { id: 'edit', label: 'Edit', icon: 'E', enabled: true },
      { id: 'delete', label: 'Delete', icon: 'D', enabled: false },
    ]);

    expect(getEnabledActions(config)).toHaveLength(1);
    expect(findToolbarAction(config, 'edit')?.id).toBe('edit');
    expect(findToolbarAction(config, 'missing')).toBeNull();
  });

  it('has sane preset configs', () => {
    expect(toolbarPresets.full.actions.length).toBeGreaterThan(0);
    expect(toolbarPresets.readOnly.actions[0]?.id).toBe('view');
    expect(toolbarPresets.disabled.enabled).toBe(false);
  });
});
