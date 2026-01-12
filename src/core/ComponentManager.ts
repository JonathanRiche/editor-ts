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
