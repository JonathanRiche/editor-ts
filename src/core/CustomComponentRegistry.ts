import type { Component, CustomComponentRegistry, CustomComponentDefinition } from '../types';
import { generateId } from '../utils/helpers';

const placeholderImageSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">'
  + '<rect width="640" height="360" rx="12" fill="#f3f4f6"/>'
  + '<rect x="64" y="64" width="512" height="232" rx="10" fill="#ffffff" stroke="#d1d5db" stroke-width="3"/>'
  + '<clipPath id="imgClip"><rect x="64" y="64" width="512" height="232" rx="10" /></clipPath>'
  + '<g clip-path="url(#imgClip)">'
  + '<path d="M120 244l72-72 68 68 48-48 112 88" fill="none" stroke="#9ca3af" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="188" cy="140" r="18" fill="#9ca3af"/>'
  + '</g>'
  + '<text x="320" y="322" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="22" fill="#6b7280">Click to upload</text>'
  + '</svg>';

const placeholderImageDataUrl = `data:image/svg+xml,${encodeURIComponent(placeholderImageSvg)}`;

export const defaultComponentFactories = {
  box: () => ({
    type: 'box',
    tagName: 'div',
    attributes: { id: generateId('box') },
    style: 'min-height: 200px;',
    components: [],
  }),
  text: () => ({
    type: 'text',
    tagName: 'div',
    attributes: { id: generateId('text') },
    content: 'Type something here…',
  }),
  image: () => ({
    type: 'image',
    tagName: 'img',
    void: true,
    attributes: { id: generateId('image'), src: placeholderImageDataUrl },
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
