import type { PageBody, Component, ComponentQuery } from '../types';
import { sanitizeHTML, cssStringToObject } from '../utils/helpers';

/**
 * Manager for handling component operations
 */
export type DomAdapter = {
  createTemplate(): HTMLTemplateElement;
};

export class ComponentManager {
  private static readonly voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  private body: PageBody;
  private parsedComponents: Component[];
  private dom: DomAdapter | null;

  constructor(body: PageBody, options?: { dom?: DomAdapter | null }) {
    this.body = body;
    this.parsedComponents = this.parse();

    this.dom = options?.dom ?? (typeof document !== 'undefined'
      ? {
          createTemplate: () => document.createElement('template'),
        }
      : null);

    // If we were given HTML without components, derive components from HTML.
    if (this.parsedComponents.length === 0 && typeof this.body.html === 'string' && this.body.html.trim() !== '') {
      this.setFromHTML(this.body.html);
    }

    // Keep html in sync when components are available.
    if (this.parsedComponents.length > 0) {
      this.syncHtmlFromComponents();
    }
  }

  /**
   * Parse components from JSON string
   */
  private parse(): Component[] {
    const raw = this.body.components;

    if (Array.isArray(raw)) {
      return raw;
    }

    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Component[];
       } catch (error: unknown) {
         const message = error instanceof Error ? error.message : String(error);
         console.error('Failed to parse components:', message);
         return [];
       }

    }

    return [];
  }

  /**
   * Find components by query
   */
  find(query: ComponentQuery): Component[] {
    return this.findInTree(this.parsedComponents, query);
  }

  /**
   * Recursively search component tree
   */
  private findInTree(components: Component[], query: ComponentQuery): Component[] {
    const results: Component[] = [];

    for (const component of components) {
      let matches = true;

      // Check ID
      if (query.id && component.attributes?.id !== query.id) {
        matches = false;
      }

      // Check type
      if (query.type && component.type !== query.type) {
        matches = false;
      }

      // Check tagName
      if (query.tagName && component.tagName !== query.tagName) {
        matches = false;
      }

      // Check attributes
      if (query.attributes && matches) {
        for (const [key, value] of Object.entries(query.attributes)) {
          if (component.attributes?.[key] !== value) {
            matches = false;
            break;
          }
        }
      }

      if (matches) {
        results.push(component);
      }

      // Search in nested components
      if (component.components && component.components.length > 0) {
        results.push(...this.findInTree(component.components, query));
      }
    }

    return results;
  }

  /**
   * Find a single component by ID
   */
  findById(id: string): Component | null {
    const results = this.find({ id });
    return results.length > 0 ? results[0]! : null;
  }

  /**
   * Find components by type
   */
  findByType(type: string): Component[] {
    return this.find({ type });
  }

  /**
   * Find components by tag name
   */
  findByTagName(tagName: string): Component[] {
    return this.find({ tagName });
  }

  /**
   * Add a component to the root level
   */
  addComponent(component: Component): void {
    this.parsedComponents.push(component);
  }

  /**
   * Add a component as a child of another component
   */
  addChildComponent(parentId: string, component: Component): boolean {
    const parent = this.findById(parentId);
    if (parent) {
      if (!parent.components) {
        parent.components = [];
      }
      parent.components.push(component);
      return true;
    }
    return false;
  }

  /**
   * Remove a component by ID
   */
  removeComponent(id: string): boolean {
    return this.removeFromTree(this.parsedComponents, id);
  }

  /**
   * Recursively remove component from tree
   */
  private removeFromTree(components: Component[], id: string): boolean {
    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      
      if (component?.attributes?.id === id) {
        components.splice(i, 1);
        return true;
      }

      if (component?.components && component.components.length > 0) {
        if (this.removeFromTree(component.components, id)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Update a component's attributes
   */
  updateComponent(id: string, updates: Partial<Component>): boolean {
    const component = this.findById(id);
    if (component) {
      Object.assign(component, updates);
      return true;
    }
    return false;
  }

  /**
   * Update a component's text content
   */
  updateTextContent(id: string, content: string): boolean {
    const component = this.findById(id);
    if (component) {
      component.content = content;
      return true;
    }
    return false;
  }

  /**
   * Update image src for a component (handles img tags and components with nested images)
   */
  updateImageSrc(id: string, src: string): boolean {
    const component = this.findById(id);
    if (component) {
      // If component is an image type or has tagName img
      if (component.tagName === 'img' || component.type === 'image') {
        component.attributes = component.attributes || {};
        component.attributes.src = src;
        return true;
      }
      // Check if component has nested image in its content
      if (component.content && component.content.includes('<img')) {
        // Update src in content HTML
        component.content = component.content.replace(
          /(<img[^>]*src=["'])[^"']*["']/i,
          `$1${src}"`
        );
        return true;
      }
      // Store as a generic image src attribute
      component.attributes = component.attributes || {};
      component.attributes.src = src;
      return true;
    }
    return false;
  }

  /**
   * Get all components
   */
  getAll(): Component[] {
    return this.parsedComponents;
  }

  /**
   * Get component count
   */
  count(): number {
    return this.countInTree(this.parsedComponents);
  }

  /**
   * Recursively count components
   */
  private countInTree(components: Component[]): number {
    let count = components.length;
    for (const component of components) {
      if (component.components && component.components.length > 0) {
        count += this.countInTree(component.components);
      }
    }
    return count;
  }

  /**
   * Convert the current component tree to HTML.
   */
  toHTML(): string {
    return this.componentsToHTML(this.parsedComponents);
  }

  /**
   * Convert the current component tree to JSX/TSX source.
   *
   * Notes:
   * - This is a best-effort export for round-tripping.
   * - Attributes are emitted as JSX props; `class` becomes `className`.
   * - Inline style strings are converted to an object expression.
   */
  toJSX(options?: { pretty?: boolean; indent?: string }): string {
    const pretty = options?.pretty ?? true;
    const indent = options?.indent ?? '  ';

    const newline = pretty ? '\n' : '';

    const toComponentName = (id: string): string => {
      const cleaned = id
        .replace(/[^a-zA-Z0-9_\-]/g, ' ')
        .trim()
        .split(/\s+|\-/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

      return cleaned.match(/^[A-Z]/) ? cleaned : `C${cleaned}`;
    };

    const definitions: string[] = [];

    const exportComponent = (component: Component) => {
      const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
      if (!id) return;

      const name = toComponentName(id);
      const body = this.componentToJSX(component, 2, { pretty, indent, newline });

      definitions.push(
        `export function ${name}() {${newline}` +
          `${indent}return (${newline}` +
          `${body}${newline}` +
          `${indent});${newline}` +
          `}${newline}`
      );
    };

    this.parsedComponents.forEach(exportComponent);

    if (definitions.length === 0) {
      // No ids to create named components; fall back to inline JSX.
      const inline = this.parsedComponents
        .map((component) => this.componentToJSX(component, 0, { pretty, indent, newline }))
        .join(newline);

      return `export function Template() {${newline}` +
        `${indent}return (${newline}` +
        `${pretty ? inline.split('\n').map((l) => (l ? indent + l : l)).join('\n') : inline}${newline}` +
        `${indent});${newline}` +
        `}`;
    }

    return definitions.join(newline);
  }

  /**
   * Replace current components by parsing the provided HTML.
   */
  setFromHTML(html: string): void {
    if (!this.dom) {
      console.warn('EditorTs: ComponentManager.setFromHTML() requires DOM; provide a dom adapter when running server-side.');
      return;
    }

    this.parsedComponents = this.htmlToComponents(html);
    this.sync();
  }

  /**
   * Replace current components by parsing the provided JSX/TSX.
   *
   * This is intended for server/build-time usage. It uses `typescript` (peer dep)
   * and does not require DOM.
   */
  async setFromJSX(source: string): Promise<void> {
    const components = await this.jsxToComponents(source);
    if (components.length === 0) return;

    this.parsedComponents = components;
    this.sync();
  }

  /**
   * Sync HTML from components back to body.html.
   */
  syncHtmlFromComponents(): void {
    this.body.html = `<body>${this.toHTML()}</body>`;
  }

  /**
   * Sync changes back to page body
   */
  sync(): void {
    this.body.components = JSON.stringify(this.parsedComponents);
    if (this.parsedComponents.length > 0) {
      this.syncHtmlFromComponents();
    }
  }

  private componentsToHTML(components: Component[]): string {
    return components.map((component) => this.componentToHTML(component)).join('');
  }

  private componentToHTML(component: Component): string {
    const tagName = component.tagName ?? 'div';
    const attributes = this.attributesToString(component.attributes);
    const style = typeof component.style === 'string' && component.style.trim() !== '' ? ` style="${sanitizeHTML(component.style)}"` : '';

    const contentText = typeof component.content === 'string' ? sanitizeHTML(component.content) : '';
    const childrenHtml = component.components ? this.componentsToHTML(component.components) : '';

    const isVoid = component.void === true || ComponentManager.voidTags.has(tagName.toLowerCase());

    if (isVoid) {
      return `<${tagName}${attributes}${style} />`;
    }

    return `<${tagName}${attributes}${style}>${contentText}${childrenHtml}</${tagName}>`;
  }

  private attributesToString(attributes: Component['attributes']): string {
    if (!attributes) return '';

    const parts: string[] = [];

    Object.entries(attributes).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'style') return;

      if (typeof value === 'boolean') {
        if (value) parts.push(`${key}`);
        return;
      }

      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      parts.push(`${key}="${sanitizeHTML(stringValue)}"`);
    });

    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
  }

  private componentToJSX(
    component: Component,
    depth: number,
    options: { pretty: boolean; indent: string; newline: string }
  ): string {
    const tagName = component.tagName ?? 'div';

    const { pretty, indent, newline } = options;
    const leading = pretty ? indent.repeat(depth) : '';

    const isVoid = component.void === true || ComponentManager.voidTags.has(tagName.toLowerCase());

    const props = this.attributesToJSXProps(component);
    const open = `<${tagName}${props}>`;

    if (isVoid) {
      return `${leading}<${tagName}${props} />`;
    }

    const children: string[] = [];

    if (typeof component.content === 'string' && component.content.trim() !== '') {
      children.push(this.escapeJsxText(component.content));
    }

    if (component.components && component.components.length > 0) {
      const rendered = component.components.map((c) => this.componentToJSX(c, depth + 1, options));
      children.push(rendered.join(newline));
    }

    if (children.length === 0) {
      return `${leading}${open}</${tagName}>`;
    }

    if (!pretty) {
      return `${leading}${open}${children.join('')}</${tagName}>`;
    }

    const inner = children
      .map((child) => {
        // If the child already has indentation (nested JSX), keep it as-is.
        if (child.startsWith(indent.repeat(depth + 1))) return child;
        return `${indent.repeat(depth + 1)}${child}`;
      })
      .join(newline);

    return `${leading}${open}${newline}${inner}${newline}${leading}</${tagName}>`;
  }

  private escapeJsxText(text: string): string {
    // Escape braces so the output remains valid JSX text.
    return text.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  }

  private cssKeyToJsx(key: string): string {
    return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  private toJsxStyleObject(styleText: string): Record<string, string> {
    const raw = cssStringToObject(styleText);
    const out: Record<string, string> = {};

    Object.entries(raw).forEach(([key, value]) => {
      out[this.cssKeyToJsx(key)] = value;
    });

    return out;
  }

  private attributesToJSXProps(component: Component): string {
    const attributes = component.attributes;
    const props: string[] = [];

    if (attributes) {
      Object.entries(attributes).forEach(([rawKey, value]) => {
        if (value === undefined || value === null) return;

        const key = rawKey === 'class' ? 'className' : rawKey;

        if (typeof value === 'string') {
          props.push(`${key}=${JSON.stringify(value)}`);
          return;
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
          props.push(`${key}={${String(value)}}`);
          return;
        }

        // Fallback: JSON
        props.push(`${key}={${JSON.stringify(value)}}`);
      });
    }

    if (typeof component.style === 'string' && component.style.trim() !== '') {
      const styleObj = this.toJsxStyleObject(component.style);
      props.push(`style={${JSON.stringify(styleObj)}}`);
    }

    return props.length > 0 ? ` ${props.join(' ')}` : '';
  }

  private async jsxToComponents(source: string): Promise<Component[]> {
    const ts = await this.loadTypeScript();
    if (!ts) return [];

    const file = ts.createSourceFile('editorts.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

    const roots: Component[] = [];

    const visit = (node: import('typescript').Node) => {
      if (ts.isJsxElement(node)) {
        const component = this.jsxElementToComponent(ts, node);
        if (component) roots.push(component);
        return;
      }

      if (ts.isJsxSelfClosingElement(node)) {
        const component = this.jsxSelfClosingElementToComponent(ts, node);
        if (component) roots.push(component);
        return;
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(file, visit);

    return roots;
  }

  private async loadTypeScript(): Promise<typeof import('typescript') | null> {
    try {
      return await import('typescript');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('EditorTs: setFromJSX() requires optional peer dependency typescript:', message);
      return null;
    }
  }

  private jsxElementToComponent(
    ts: typeof import('typescript'),
    node: import('typescript').JsxElement
  ): Component | null {
    const opening = node.openingElement;

    const tagName = this.jsxTagName(ts, opening.tagName);
    if (!tagName) return null;

    const component: Component = {
      type: tagName,
      tagName,
      attributes: this.jsxAttributesToRecord(ts, opening.attributes),
    };

    const children = this.jsxChildrenToComponents(ts, node.children);
    if (children.length > 0) {
      component.components = children;
    }

    // Prefer textContent only when there are no nested JSX elements.
    const textContent = node.children
      .filter((c) => ts.isJsxText(c))
      .map((c) => c.getText())
      .join('')
      .trim();

    if (children.length === 0 && textContent !== '') {
      component.content = textContent;
    }

    return component;
  }

  private jsxSelfClosingElementToComponent(
    ts: typeof import('typescript'),
    node: import('typescript').JsxSelfClosingElement
  ): Component | null {
    const tagName = this.jsxTagName(ts, node.tagName);
    if (!tagName) return null;

    const component: Component = {
      type: tagName,
      tagName,
      attributes: this.jsxAttributesToRecord(ts, node.attributes),
      void: true,
    };

    return component;
  }

  private jsxChildrenToComponents(
    ts: typeof import('typescript'),
    children: readonly import('typescript').JsxChild[]
  ): Component[] {
    const out: Component[] = [];

    children.forEach((child) => {
      if (ts.isJsxElement(child)) {
        const next = this.jsxElementToComponent(ts, child);
        if (next) out.push(next);
      } else if (ts.isJsxSelfClosingElement(child)) {
        const next = this.jsxSelfClosingElementToComponent(ts, child);
        if (next) out.push(next);
      }
    });

    return out;
  }

  private jsxTagName(
    ts: typeof import('typescript'),
    tagName: import('typescript').JsxTagNameExpression
  ): string | null {
    if (ts.isIdentifier(tagName)) {
      // Only allow intrinsic tags here.
      return tagName.text;
    }

    if (ts.isPropertyAccessExpression(tagName)) {
      return tagName.getText();
    }

    return tagName.getText();
  }

  private jsxAttributesToRecord(
    ts: typeof import('typescript'),
    attrs: import('typescript').JsxAttributes
  ): Component['attributes'] {
    const out: Component['attributes'] = {};

    attrs.properties.forEach((prop) => {
      if (ts.isJsxAttribute(prop)) {
        const key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();

        if (!prop.initializer) {
          out[key] = true;
          return;
        }

        if (ts.isStringLiteral(prop.initializer)) {
          out[key] = prop.initializer.text;
          return;
        }

        if (ts.isJsxExpression(prop.initializer)) {
          const expr = prop.initializer.expression;
          if (!expr) return;

          if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
            out[key] = expr.text;
            return;
          }

          if (ts.isNumericLiteral(expr)) {
            out[key] = Number(expr.text);
            return;
          }

          if (expr.kind === ts.SyntaxKind.TrueKeyword) {
            out[key] = true;
            return;
          }

          if (expr.kind === ts.SyntaxKind.FalseKeyword) {
            out[key] = false;
            return;
          }

          // For now, fall back to source string.
          out[key] = expr.getText();
          return;
        }
      }

      if (ts.isJsxSpreadAttribute(prop)) {
        // Spread props are not representable in JSON; ignore for now.
        return;
      }
    });

    return out;
  }

  private htmlToComponents(html: string): Component[] {
    // Strip outer <body> wrapper if present.
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1]! : html;

    if (!this.dom) {
      console.warn('EditorTs: ComponentManager.htmlToComponents() requires DOM; provide a dom adapter when running server-side.');
      return [];
    }

    const template = this.dom.createTemplate();
    template.innerHTML = bodyHtml;

    const elements = Array.from(template.content.children) as HTMLElement[];
    return elements.map((el) => this.elementToComponent(el));
  }

  private elementToComponent(el: HTMLElement): Component {
    const tagName = el.tagName.toLowerCase();

    const attributes: Component['attributes'] = {};
    Array.from(el.attributes).forEach((attr) => {
      if (attributes) {
        attributes[attr.name] = attr.value;
      }
    });

    const childElements = Array.from(el.children) as HTMLElement[];

    const component: Component = {
      type: tagName,
      tagName,
      attributes,
    };

    // Only treat as text content when there are no nested elements.
    if (childElements.length === 0) {
      const text = el.textContent ?? '';
      if (text.trim() !== '') {
        component.content = text;
      }
    }

    if (childElements.length > 0) {
      component.components = childElements.map((child) => this.elementToComponent(child));
    }

    if (ComponentManager.voidTags.has(tagName)) {
      component.void = true;
    }

    return component;
  }

  /**
   * Replace all components
   */
  replaceAll(components: Component[]): void {
    this.parsedComponents = components;
  }

  /**
   * Move a component to a new position
   * @param componentId - The ID of the component to move
   * @param newParentId - The ID of the new parent (null for root level)
   * @param newIndex - The index position within the new parent
   */
  moveComponent(componentId: string, newParentId: string | null, newIndex: number): boolean {
    // Find and remove the component from its current location
    const component = this.findById(componentId);
    if (!component) return false;

    // Remove from current location
    if (!this.removeComponent(componentId)) return false;

    // Add to new location
    if (newParentId === null) {
      // Move to root level
      const insertIndex = Math.min(newIndex, this.parsedComponents.length);
      this.parsedComponents.splice(insertIndex, 0, component);
    } else {
      // Move to a parent component
      const parent = this.findById(newParentId);
      if (!parent) {
        // Restore component to root if parent not found
        this.parsedComponents.push(component);
        return false;
      }
      
      if (!parent.components) {
        parent.components = [];
      }
      
      const insertIndex = Math.min(newIndex, parent.components.length);
      parent.components.splice(insertIndex, 0, component);
    }

    return true;
  }

  /**
   * Reorder a component within its current parent
   * @param componentId - The ID of the component to reorder
   * @param newIndex - The new index position
   */
  reorderComponent(componentId: string, newIndex: number): boolean {
    // Find the parent that contains this component
    const result = this.findParentAndIndex(componentId);
    if (!result) return false;

    const { parent, index } = result;
    const components = parent ? parent.components! : this.parsedComponents;
    
    // Remove from current position
    const [component] = components.splice(index, 1);
    
    // Insert at new position (adjust for removal)
    const adjustedIndex = newIndex > index ? newIndex - 1 : newIndex;
    const insertIndex = Math.min(Math.max(0, adjustedIndex), components.length);
    components.splice(insertIndex, 0, component!);

    return true;
  }

  /**
   * Get the parent component ID and index for a component.
   * Returns { parentId: null } when the component is at the root.
   */
  getParentAndIndex(componentId: string): { parentId: string | null; index: number } | null {
    const result = this.findParentAndIndex(componentId);
    if (!result) return null;

    return {
      parentId: result.parent?.attributes?.id ?? null,
      index: result.index,
    };
  }

  /**
   * Find the parent component and index of a component
   */
  private findParentAndIndex(componentId: string): { parent: Component | null; index: number } | null {
    // Check root level
    for (let i = 0; i < this.parsedComponents.length; i++) {
      if (this.parsedComponents[i]?.attributes?.id === componentId) {
        return { parent: null, index: i };
      }
    }

    // Search recursively
    return this.findParentAndIndexInTree(this.parsedComponents, componentId);
  }

  /**
   * Recursively search for parent and index
   */
  private findParentAndIndexInTree(components: Component[], componentId: string): { parent: Component | null; index: number } | null {
    for (const component of components) {
      if (component.components) {
        for (let i = 0; i < component.components.length; i++) {
          if (component.components[i]?.attributes?.id === componentId) {
            return { parent: component, index: i };
          }
        }
        // Search deeper
        const result = this.findParentAndIndexInTree(component.components, componentId);
        if (result) return result;
      }
    }
    return null;
  }
}
