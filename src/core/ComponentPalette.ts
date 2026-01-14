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

  private render(): void {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexWrap = 'wrap';
    wrapper.style.gap = '0.5rem';
    wrapper.style.alignItems = 'flex-start';

    const types = Object.keys(this.registry).sort();

    if (types.length === 0) {
      this.container.textContent = 'No components available';
      return;
    }

    types.forEach((type) => {
      const def = this.registry[type];
      if (!def) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.border = '1px solid rgba(0,0,0,0.12)';
      btn.style.borderRadius = '6px';
      btn.style.padding = '0.5rem';
      btn.style.background = 'white';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '0.75rem';
      btn.style.width = '5.75rem';
      btn.style.display = 'flex';
      btn.style.flexDirection = 'column';
      btn.style.alignItems = 'center';
      btn.style.gap = '0.35rem';

      const icon = document.createElement('div');
      icon.style.width = '24px';
      icon.style.height = '24px';
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.justifyContent = 'center';
      icon.style.color = '#111827';

      if (typeof def.iconSvg === 'string' && def.iconSvg.trim() !== '') {
        icon.innerHTML = def.iconSvg;
      } else {
        icon.textContent = '⬚';
      }

      const label = document.createElement('div');
      label.textContent = def.label ?? type;
      label.style.textAlign = 'center';
      label.style.width = '100%';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';

      btn.appendChild(icon);
      btn.appendChild(label);

      btn.style.outline = this.selectedType === type ? '2px solid #3b82f6' : 'none';

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
