import { describe, expect, it } from 'bun:test';
import { cssObjectToString, cssStringToObject, flattenComponents, generateId, parseSelector } from '../src/utils/helpers';
import type { Component } from '../src/types';

describe('helpers', () => {
  it('converts CSS objects to strings and back', () => {
    const css = { color: 'red', 'font-size': '16px' };
    const stringified = cssObjectToString(css);

    expect(stringified).toContain('color: red;');
    expect(stringified).toContain('font-size: 16px;');

    const parsed = cssStringToObject(stringified);
    expect(parsed).toEqual(css);
  });

  it('flattens nested components', () => {
    const tree: Component[] = [
      {
        type: 'box',
        attributes: { id: 'root' },
        components: [
          { type: 'text', attributes: { id: 'child' }, content: 'Hello' },
        ],
      },
    ];

    const flat = flattenComponents(tree);

    expect(flat).toHaveLength(2);
    expect(flat.map((item) => item.attributes?.id)).toEqual(['root', 'child']);
  });

  it('generates ids with prefix and timestamp', () => {
    const id = generateId('test');

    expect(id.startsWith('test-')).toBe(true);
    expect(id.length).toBeGreaterThan(6);
  });

  it('parses selectors', () => {
    expect(parseSelector('#hero')).toEqual({ type: 'id', name: 'hero' });
    expect(parseSelector('.cta')).toEqual({ type: 'class', name: 'cta' });
    expect(parseSelector('section')).toEqual({ type: 'tag', name: 'section' });
    expect(parseSelector('main > h1').type).toBe('complex');
  });
});
