/**
 * SuperTab - TypeScript library for HTML content editing with JSON representation
 * 
 * @example
 * ```typescript
 * import { Page } from 'supertab';
 * 
 * // Load from JSON
 * const page = new Page(jsonData);
 * 
 * // Find and update components
 * const header = page.components.findById('header');
 * page.components.updateComponent('header', { style: 'color: red;' });
 * 
 * // Manage styles
 * page.styles.updateStyle('#header', { 'font-size': '2rem' });
 * 
 * // Export back to JSON
 * const json = page.toJSON();
 * ```
 */

// Core exports
export { Page } from './src/core/Page';
export { ComponentManager } from './src/core/ComponentManager';
export { StyleManager } from './src/core/StyleManager';
export { AssetManager } from './src/core/AssetManager';
export { ToolbarManager } from './src/core/ToolbarManager';
export { init } from './src/core/init';

// Type exports
export type {
  PageData,
  PageBody,
  Component,
  Asset,
  Style,
  CSSProperties,
  ComponentQuery,
  StyleQuery,
  UpdateOptions,
  SelectorObject,
  ParsedComponents,
  ToolbarConfig,
  ToolbarAction,
  ToolbarRule,
  ComponentSelector,
  InitConfig,
  ToolbarInitConfig,
  UIConfig,
  SuperTabEditor,
} from './src/types';

// Utility exports
export {
  deepClone,
  generateId,
  cssObjectToString,
  cssStringToObject,
  flattenComponents,
  getComponentByPath,
  sanitizeHTML,
  extractComponentIds,
  mergeCSSProperties,
  isIdSelector,
  isClassSelector,
  parseSelector,
  formatFileSize,
  isValidURL,
  extractDomain,
} from './src/utils/helpers';

// Toolbar exports
export {
  defaultToolbarActions,
  defaultToolbarConfig,
  createToolbarConfig,
  mergeToolbarConfigs,
  getEnabledActions,
  findToolbarAction,
  toolbarPresets,
} from './src/utils/toolbar';
