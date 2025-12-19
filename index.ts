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
