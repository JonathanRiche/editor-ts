import type { PageBody, Component, ComponentQuery } from '../types';

/**
 * Manager for handling component operations
 */
export class ComponentManager {
  private body: PageBody;
  private parsedComponents: Component[];

  constructor(body: PageBody) {
    this.body = body;
    this.parsedComponents = this.parse();
  }

  /**
   * Parse components from JSON string
   */
  private parse(): Component[] {
    try {
      return JSON.parse(this.body.components) as Component[];
    } catch (error) {
      console.error('Failed to parse components:', error);
      return [];
    }
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
   * Sync changes back to page body
   */
  sync(): void {
    this.body.components = JSON.stringify(this.parsedComponents);
  }

  /**
   * Replace all components
   */
  replaceAll(components: Component[]): void {
    this.parsedComponents = components;
  }
}
