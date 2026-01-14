import type { Component, CustomComponentRegistry, CustomComponentDefinition } from '../types';
import { generateId } from '../utils/helpers';

export const defaultComponentFactories = {
  box: () => ({
    type: 'box',
    tagName: 'div',
    attributes: { id: generateId('box') },
    components: [],
  }),
  text: () => ({
    type: 'text',
    tagName: 'div',
    attributes: { id: generateId('text') },
    content: 'New text',
  }),
  image: () => ({
    type: 'image',
    tagName: 'img',
    void: true,
    attributes: { id: generateId('image'), src: '' },
  }),
};

export const defaultComponentRegistry: CustomComponentRegistry = {
  box: {
    type: 'box',
    label: 'Box',
    iconSvg:
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>',
    factory: defaultComponentFactories.box,
  },
  text: {
    type: 'text',
    label: 'Text',
    iconSvg:
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M10 6v12"/><path d="M14 6v12"/><path d="M4 18h16"/></svg>',
    factory: defaultComponentFactories.text,
  },
  image: {
    type: 'image',
    label: 'Image',
    iconSvg:
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 14l2-2 3 3 2-2 3 3"/><circle cx="9" cy="9" r="1"/></svg>',
    factory: defaultComponentFactories.image,
  },
};

export function mergeCustomComponentRegistry(
  baseRegistry: CustomComponentRegistry,
  overrides?: CustomComponentRegistry
): CustomComponentRegistry {
  if (!overrides) return baseRegistry;
  return { ...baseRegistry, ...overrides };
}

export function createCustomComponentDefinition(def: CustomComponentDefinition): CustomComponentDefinition {
  return def;
}
