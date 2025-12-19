import type { Component, CSSProperties } from '../types';

/**
 * Utility functions for working with page data
 */

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a unique ID
 */
export function generateId(prefix = 'id'): string {
  const random = Math.random().toString(36).substring(2, 9);
  const timestamp = Date.now().toString(36);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Convert CSS object to CSS string
 */
export function cssObjectToString(css: CSSProperties): string {
  return Object.entries(css)
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
}

/**
 * Convert CSS string to CSS object
 */
export function cssStringToObject(cssString: string): CSSProperties {
  const css: CSSProperties = {};
  const declarations = cssString.split(';').filter((d) => d.trim());

  for (const declaration of declarations) {
    const [key, ...valueParts] = declaration.split(':');
    if (key && valueParts.length > 0) {
      css[key.trim()] = valueParts.join(':').trim();
    }
  }

  return css;
}

/**
 * Flatten component tree to array
 */
export function flattenComponents(components: Component[]): Component[] {
  const result: Component[] = [];

  function traverse(comps: Component[]) {
    for (const comp of comps) {
      result.push(comp);
      if (comp.components && comp.components.length > 0) {
        traverse(comp.components);
      }
    }
  }

  traverse(components);
  return result;
}

/**
 * Find component by path (e.g., "0.1.2" for first component, second child, third grandchild)
 */
export function getComponentByPath(components: Component[], path: string): Component | null {
  const indices = path.split('.').map(Number);
  let current: Component[] = components;

  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    if (index === undefined || !current[index]) {
      return null;
    }

    if (i === indices.length - 1) {
      return current[index]!;
    }

    current = current[index]!.components || [];
  }

  return null;
}

/**
 * Sanitize HTML string
 */
export function sanitizeHTML(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Extract all IDs from component tree
 */
export function extractComponentIds(components: Component[]): string[] {
  const ids: string[] = [];

  function traverse(comps: Component[]) {
    for (const comp of comps) {
      if (comp.attributes?.id) {
        ids.push(comp.attributes.id as string);
      }
      if (comp.components && comp.components.length > 0) {
        traverse(comp.components);
      }
    }
  }

  traverse(components);
  return ids;
}

/**
 * Merge CSS properties (later properties override earlier ones)
 */
export function mergeCSSProperties(...properties: CSSProperties[]): CSSProperties {
  return Object.assign({}, ...properties);
}

/**
 * Check if a selector is an ID selector
 */
export function isIdSelector(selector: string): boolean {
  return selector.startsWith('#');
}

/**
 * Check if a selector is a class selector
 */
export function isClassSelector(selector: string): boolean {
  return selector.startsWith('.');
}

/**
 * Parse selector to extract name
 */
export function parseSelector(selector: string): { type: 'id' | 'class' | 'tag' | 'complex'; name: string } {
  if (isIdSelector(selector)) {
    return { type: 'id', name: selector.substring(1) };
  }
  if (isClassSelector(selector)) {
    return { type: 'class', name: selector.substring(1) };
  }
  if (selector.includes(' ') || selector.includes('>') || selector.includes('+')) {
    return { type: 'complex', name: selector };
  }
  return { type: 'tag', name: selector };
}

/**
 * Format file size in bytes to human-readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Validate URL
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}
