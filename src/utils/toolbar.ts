import type { ToolbarConfig, ToolbarAction } from '../types';

/**
 * Default toolbar configurations
 */

/**
 * Default toolbar actions available for all components
 */
export const defaultToolbarActions: ToolbarAction[] = [
  {
    id: 'edit',
    label: 'Edit',
    icon: '✏️',
    enabled: true,
    description: 'Edit component properties in sidebar',
  },
  {
    id: 'editJS',
    label: 'Edit JS',
    icon: '📜',
    enabled: true,
    description: 'Edit component JavaScript',
  },
  {
    id: 'editCSS',
    label: 'Edit CSS',
    icon: '🎨',
    enabled: true,
    description: 'Edit page CSS',
  },
  {
    id: 'editJSON',
    label: 'Edit JSON',
    icon: '🧱',
    enabled: true,
    description: 'View/edit full page JSON structure',
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    icon: '📋',
    enabled: true,
    description: 'Create a copy of this component',
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: '🗑️',
    enabled: true,
    danger: true,
    description: 'Remove this component from the page',
  },
];

/**
 * Default toolbar configuration
 */
export const defaultToolbarConfig: ToolbarConfig = {
  enabled: true,
  actions: defaultToolbarActions,
};

/**
 * Create a custom toolbar config
 */
export function createToolbarConfig(
  actions: ToolbarAction[],
  enabled = true
): ToolbarConfig {
  return {
    enabled,
    actions,
  };
}

/**
 * Merge toolbar configs (later config overrides earlier)
 */
export function mergeToolbarConfigs(
  base: ToolbarConfig,
  override: Partial<ToolbarConfig>
): ToolbarConfig {
  return {
    enabled: override.enabled ?? base.enabled,
    actions: override.actions ?? base.actions,
  };
}

/**
 * Get enabled actions from a toolbar config
 */
export function getEnabledActions(config: ToolbarConfig): ToolbarAction[] {
  return config.actions.filter((action) => action.enabled);
}

/**
 * Find a specific action in toolbar config
 */
export function findToolbarAction(
  config: ToolbarConfig,
  actionId: string
): ToolbarAction | null {
  const action = config.actions.find((a) => a.id === actionId);
  return action || null;
}

/**
 * Preset toolbar configs for common scenarios
 */
export const toolbarPresets = {
  /**
   * Full toolbar with all actions
   */
  full: defaultToolbarConfig,

  /**
   * Read-only toolbar (only view actions)
   */
  readOnly: createToolbarConfig([
    {
      id: 'view',
      label: 'View',
      icon: '👁️',
      enabled: true,
      description: 'View component details',
    },
  ]),

  /**
   * Edit-only toolbar (no delete)
   */
  editOnly: createToolbarConfig([
    { ...defaultToolbarActions[0]! }, // edit
    { ...defaultToolbarActions[1]! }, // editJS
    { ...defaultToolbarActions[2]! }, // duplicate
  ]),

  /**
   * Minimal toolbar (edit and delete only)
   */
  minimal: createToolbarConfig([
    { ...defaultToolbarActions[0]! }, // edit
    { ...defaultToolbarActions[3]! }, // delete
  ]),

  /**
   * Disabled toolbar
   */
  disabled: {
    enabled: false,
    actions: [],
  },
};
