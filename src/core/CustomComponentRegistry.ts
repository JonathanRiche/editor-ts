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
  box: { type: 'box', label: 'Box', factory: defaultComponentFactories.box },
  text: { type: 'text', label: 'Text', factory: defaultComponentFactories.text },
  image: { type: 'image', label: 'Image', factory: defaultComponentFactories.image },
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
