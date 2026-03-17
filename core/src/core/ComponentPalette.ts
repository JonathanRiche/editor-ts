import type { Component, CustomComponentRegistry } from '../types';

export type ComponentPaletteConfig = {
  container: HTMLElement;
  registry: CustomComponentRegistry;
  onPick: (type: string) => void;
};

export class ComponentPalette {
  private container: HTMLElement;
  private registry: CustomComponentRegistry;
  private onPick: (type: string) => void;
  private selectedType: string | null = null;

  constructor(config: ComponentPaletteConfig) {
    this.container = config.container;
    this.registry = config.registry;
    this.onPick = config.onPick;

    this.injectStyles();
    this.render();
  }

  updateRegistry(registry: CustomComponentRegistry): void {
    this.registry = registry;
    this.render();
  }

  setSelected(type: string | null): void {
    this.selectedType = type;
    this.render();
  }

  destroy(): void {
    this.container.innerHTML = '';
  }

  /**
   * Inject palette styles into the document (once, like LayerManager)
   */
  private injectStyles(): void {
    if (document.getElementById('editorts-cp-styles')) return;

    const style = document.createElement('style');
    style.id = 'editorts-cp-styles';
    style.textContent = `
      .editorts-cp-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: flex-start;
      }
      .editorts-cp-btn {
        appearance: none;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 6px;
        padding: 0.45rem;
        background: white;
        cursor: pointer;
        font-size: 0.7rem;
        width: 5.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.3rem;
        color: inherit;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .editorts-cp-btn:hover {
        border-color: rgba(0, 0, 0, 0.2);
        background: #f9fafb;
      }
      .editorts-cp-btn.selected {
        outline: 2px solid #3b82f6;
        outline-offset: -1px;
      }
      .editorts-cp-icon {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #374151;
      }
      .editorts-cp-label {
        text-align: center;
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #6b7280;
      }
      .editorts-cp-empty {
        font-size: 0.8rem;
        color: #9ca3af;
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }

  private render(): void {
    this.container.innerHTML = '';

    const types = Object.keys(this.registry).sort();

    if (types.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'editorts-cp-empty';
      empty.textContent = 'No components available';
      this.container.appendChild(empty);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'editorts-cp-grid';

    types.forEach((type) => {
      const def = this.registry[type];
      if (!def) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `editorts-cp-btn${this.selectedType === type ? ' selected' : ''}`;

      const icon = document.createElement('div');
      icon.className = 'editorts-cp-icon';

      if (typeof def.iconSvg === 'string' && def.iconSvg.trim() !== '') {
        icon.innerHTML = def.iconSvg;
      } else {
        icon.textContent = '\u2B1A';
      }

      const label = document.createElement('div');
      label.className = 'editorts-cp-label';
      label.textContent = def.label ?? type;

      btn.appendChild(icon);
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        this.selectedType = type;
        this.onPick(type);
        this.render();
      });

      wrapper.appendChild(btn);
    });

    this.container.appendChild(wrapper);
  }
}
