import type { Component, ToolbarConfig, ToolbarRule, ComponentSelector } from '../types';
import { defaultToolbarConfig } from '../utils/toolbar';

/**
 * Manager for runtime toolbar configurations
 * Toolbars are NOT stored in JSON - they are configured at runtime
 */
export class ToolbarManager {
  private rules: ToolbarRule[] = [];
  private globalDefault: ToolbarConfig = defaultToolbarConfig;

  /**
   * Set global default toolbar for all components
   */
  setGlobalDefault(config: ToolbarConfig): void {
    this.globalDefault = config;
  }

  /**
   * Configure toolbar for components matching a selector
   */
  configure(selector: ComponentSelector, config: ToolbarConfig): void {
    // Remove existing rule for same selector
    this.rules = this.rules.filter(rule => 
      JSON.stringify(rule.selector) !== JSON.stringify(selector)
    );
    
    // Add new rule
    this.rules.push({ selector, config });
  }

  /**
   * Configure toolbar by component ID
   */
  configureById(id: string, config: ToolbarConfig): void {
    this.configure({ id }, config);
  }

  /**
   * Configure toolbar by component type
   */
  configureByType(type: string, config: ToolbarConfig): void {
    this.configure({ type }, config);
  }

  /**
   * Configure toolbar by tag name
   */
  configureByTag(tagName: string, config: ToolbarConfig): void {
    this.configure({ tagName }, config);
  }

  /**
   * Configure toolbar with custom matcher function
   */
  configureCustom(matcher: (component: Component) => boolean, config: ToolbarConfig): void {
    this.configure({ custom: matcher }, config);
  }

  /**
   * Get toolbar configuration for a specific component
   */
  getToolbarForComponent(component: Component): ToolbarConfig {
    // Check rules in reverse order (last added has priority)
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i];
      if (rule && this.matchesSelector(component, rule.selector)) {
        return rule.config;
      }
    }

    // Return global default
    return this.globalDefault;
  }

  /**
   * Get toolbar by component ID (convenience method)
   */
  getToolbarById(components: Component[], id: string): ToolbarConfig | null {
    const component = this.findComponentById(components, id);
    if (component) {
      return this.getToolbarForComponent(component);
    }
    return null;
  }

  /**
   * Check if component matches selector
   */
  private matchesSelector(component: Component, selector: ComponentSelector): boolean {
    if ('id' in selector) {
      return component.attributes?.id === selector.id;
    }
    if ('type' in selector) {
      return component.type === selector.type;
    }
    if ('tagName' in selector) {
      return component.tagName === selector.tagName;
    }
    if ('attributes' in selector) {
      return Object.entries(selector.attributes).every(
        ([key, value]) => component.attributes?.[key] === value
      );
    }
    if ('custom' in selector) {
      return selector.custom(component);
    }
    return false;
  }

  /**
   * Find component by ID in tree
   */
  private findComponentById(components: Component[], id: string): Component | null {
    for (const comp of components) {
      if (comp.attributes?.id === id) {
        return comp;
      }
      if (comp.components && comp.components.length > 0) {
        const found = this.findComponentById(comp.components, id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Remove toolbar configuration for a selector
   */
  removeConfiguration(selector: ComponentSelector): boolean {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter(rule => 
      JSON.stringify(rule.selector) !== JSON.stringify(selector)
    );
    return this.rules.length < initialLength;
  }

  /**
   * Clear all toolbar configurations
   */
  clearAll(): void {
    this.rules = [];
  }

  /**
   * Get all toolbar rules
   */
  getAllRules(): ToolbarRule[] {
    return [...this.rules];
  }

  /**
   * Export toolbar configuration as JSON (for sharing config, not data)
   */
  exportConfig(): string {
    return JSON.stringify({
      globalDefault: this.globalDefault,
      rules: this.rules,
    }, null, 2);
  }

  /**
   * Import toolbar configuration from JSON
   */
  importConfig(json: string): void {
    const config = JSON.parse(json);
    this.globalDefault = config.globalDefault || defaultToolbarConfig;
    this.rules = config.rules || [];
  }
}
