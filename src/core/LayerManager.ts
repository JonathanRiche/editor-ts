import type { Component } from '../types';

export interface LayerManagerConfig {
  container: HTMLElement;
  onSelect?: (component: Component) => void;
  onReorder?: (componentId: string, newParentId: string | null, newIndex: number) => void;
}

/**
 * LayerManager - Renders a Figma/Photoshop-style layer panel
 * showing component hierarchy with drag-and-drop reordering
 */
export class LayerManager {
  private container: HTMLElement;
  private components: Component[] = [];
  private selectedId: string | null = null;
  private onSelect?: (component: Component) => void;
  private onReorder?: (componentId: string, newParentId: string | null, newIndex: number) => void;
  private draggedElement: HTMLElement | null = null;
  private draggedId: string | null = null;

  constructor(config: LayerManagerConfig) {
    this.container = config.container;
    this.onSelect = config.onSelect;
    this.onReorder = config.onReorder;
    this.injectStyles();
  }

  /**
   * Inject layer panel styles into the document
   */
  private injectStyles(): void {
    if (document.getElementById('editorts-layer-styles')) return;

    const style = document.createElement('style');
    style.id = 'editorts-layer-styles';
    style.textContent = `
      .editorts-layer-panel {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        user-select: none;
      }
      .editorts-layer-item {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 4px;
        margin: 2px 0;
        transition: background-color 0.15s;
      }
      .editorts-layer-item:hover {
        background-color: rgba(0, 0, 0, 0.05);
      }
      .editorts-layer-item.selected {
        background-color: rgba(59, 130, 246, 0.15);
        outline: 1px solid rgba(59, 130, 246, 0.3);
      }
      .editorts-layer-item.drag-over {
        background-color: rgba(16, 185, 129, 0.15);
        outline: 2px dashed #10b981;
      }
      .editorts-layer-item.dragging {
        opacity: 0.5;
      }
      .editorts-layer-toggle {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 4px;
        cursor: pointer;
        color: #666;
        font-size: 10px;
      }
      .editorts-layer-toggle:hover {
        color: #333;
      }
      .editorts-layer-icon {
        width: 16px;
        height: 16px;
        margin-right: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      }
      .editorts-layer-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #333;
      }
      .editorts-layer-type {
        font-size: 11px;
        color: #888;
        margin-left: 8px;
      }
      .editorts-layer-children {
        margin-left: 16px;
        border-left: 1px solid #e5e7eb;
        padding-left: 4px;
      }
      .editorts-layer-children.collapsed {
        display: none;
      }
      .editorts-layer-empty {
        padding: 12px;
        text-align: center;
        color: #888;
        font-style: italic;
      }
      .editorts-drop-indicator {
        height: 2px;
        background-color: #3b82f6;
        margin: 0 8px;
        border-radius: 1px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Update the layer panel with new components
   */
  update(components: Component[]): void {
    this.components = components;
    this.render();
  }

  /**
   * Set the selected component (highlight in layer panel)
   */
  setSelected(id: string | null): void {
    this.selectedId = id;
    
    // Update visual selection
    this.container.querySelectorAll('.editorts-layer-item').forEach(el => {
      el.classList.toggle('selected', el.getAttribute('data-id') === id);
    });
  }

  /**
   * Render the layer panel
   */
  private render(): void {
    this.container.innerHTML = '';
    
    const panel = document.createElement('div');
    panel.className = 'editorts-layer-panel';

    if (this.components.length === 0) {
      panel.innerHTML = '<div class="editorts-layer-empty">No components</div>';
    } else {
      this.components.forEach((component, index) => {
        panel.appendChild(this.renderLayerItem(component, 0, null, index));
      });
    }

    this.container.appendChild(panel);
  }

  /**
   * Render a single layer item with its children
   */
  private renderLayerItem(component: Component, depth: number, parentId: string | null, index: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'editorts-layer-wrapper';
    
    const id = component.attributes?.id || `component-${depth}-${index}`;
    const hasChildren = component.components && component.components.length > 0;
    
    // Layer item
    const item = document.createElement('div');
    item.className = 'editorts-layer-item';
    item.setAttribute('data-id', id);
    item.setAttribute('data-parent-id', parentId || '');
    item.setAttribute('data-index', String(index));
    item.setAttribute('draggable', 'true');
    
    if (id === this.selectedId) {
      item.classList.add('selected');
    }

    // Toggle for children
    const toggle = document.createElement('span');
    toggle.className = 'editorts-layer-toggle';
    if (hasChildren) {
      toggle.textContent = '▼';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const children = wrapper.querySelector('.editorts-layer-children');
        if (children) {
          children.classList.toggle('collapsed');
          toggle.textContent = children.classList.contains('collapsed') ? '▶' : '▼';
        }
      });
    }
    item.appendChild(toggle);

    // Icon based on component type/tag
    const icon = document.createElement('span');
    icon.className = 'editorts-layer-icon';
    icon.textContent = this.getIconForComponent(component);
    item.appendChild(icon);

    // Name (id or type)
    const name = document.createElement('span');
    name.className = 'editorts-layer-name';
    name.textContent = component.attributes?.id || component.tagName || 'Component';
    item.appendChild(name);

    // Type badge
    const type = document.createElement('span');
    type.className = 'editorts-layer-type';
    type.textContent = component.tagName || component.type || '';
    item.appendChild(type);

    // Click to select
    item.addEventListener('click', () => {
      this.setSelected(id);
      if (this.onSelect) {
        this.onSelect(component);
      }
    });

    // Drag and drop
    this.setupDragAndDrop(item, id);

    wrapper.appendChild(item);

    // Render children
    if (hasChildren) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'editorts-layer-children';
      
      component.components!.forEach((child, childIndex) => {
        childrenContainer.appendChild(this.renderLayerItem(child, depth + 1, id, childIndex));
      });
      
      wrapper.appendChild(childrenContainer);
    }

    return wrapper;
  }

  /**
   * Setup drag and drop for a layer item
   */
  private setupDragAndDrop(element: HTMLElement, id: string): void {
    element.addEventListener('dragstart', (e) => {
      this.draggedElement = element;
      this.draggedId = id;
      element.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', id);
    });

    element.addEventListener('dragend', () => {
      if (this.draggedElement) {
        this.draggedElement.classList.remove('dragging');
      }
      this.container.querySelectorAll('.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });
      this.draggedElement = null;
      this.draggedId = null;
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.draggedId === id) return;
      element.classList.add('drag-over');
    });

    element.addEventListener('dragleave', () => {
      element.classList.remove('drag-over');
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      element.classList.remove('drag-over');
      
      if (!this.draggedId || this.draggedId === id) return;

      const targetParentId = element.getAttribute('data-parent-id') || null;
      const targetIndex = parseInt(element.getAttribute('data-index') || '0', 10);

      if (this.onReorder) {
        this.onReorder(this.draggedId, targetParentId, targetIndex);
      }
    });
  }

  /**
   * Get icon for component based on type/tag
   */
  private getIconForComponent(component: Component): string {
    const tag = component.tagName?.toLowerCase();
    const type = component.type?.toLowerCase();

    // Check tag first
    if (tag) {
      switch (tag) {
        case 'img': return '🖼️';
        case 'video': return '🎬';
        case 'audio': return '🔊';
        case 'a': return '🔗';
        case 'button': return '🔘';
        case 'input': return '📝';
        case 'form': return '📋';
        case 'table': return '📊';
        case 'ul':
        case 'ol': return '📃';
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': return '📰';
        case 'p':
        case 'span': return '📄';
        case 'section':
        case 'article':
        case 'div': return '📦';
        case 'header': return '⬆️';
        case 'footer': return '⬇️';
        case 'nav': return '🧭';
        default: return '📦';
      }
    }

    // Check type
    if (type) {
      switch (type) {
        case 'image': return '🖼️';
        case 'text': return '📄';
        case 'box': return '📦';
        case 'custom-code': return '📜';
        default: return '📦';
      }
    }

    return '📦';
  }

  /**
   * Expand all layers
   */
  expandAll(): void {
    this.container.querySelectorAll('.editorts-layer-children').forEach(el => {
      el.classList.remove('collapsed');
    });
    this.container.querySelectorAll('.editorts-layer-toggle').forEach(el => {
      if (el.textContent) el.textContent = '▼';
    });
  }

  /**
   * Collapse all layers
   */
  collapseAll(): void {
    this.container.querySelectorAll('.editorts-layer-children').forEach(el => {
      el.classList.add('collapsed');
    });
    this.container.querySelectorAll('.editorts-layer-toggle').forEach(el => {
      if (el.textContent) el.textContent = '▶';
    });
  }

  /**
   * Destroy the layer manager
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
