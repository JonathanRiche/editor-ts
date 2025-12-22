/**
 * SuperTab Editor Initialization
 * This file provides the init() function that sets up the entire editor with minimal config
 */

import { Page } from './Page';
import type { InitConfig, SuperTabEditor, Component } from '../types';

/**
 * Initialize SuperTab Editor
 * Returns a SuperTabEditor instance with full access to the Page and event system
 */
export function init(config: InitConfig): SuperTabEditor {
  // Get container
  const container = document.getElementById(config.containerId)!;
  if (!container) {
    throw new Error(`Container element #${config.containerId} not found`);
  }

  // Create Page instance
  const page = new Page(config.data);

  // Configure toolbars from config
  if (config.toolbars) {
    // By ID
    if (config.toolbars.byId) {
      Object.entries(config.toolbars.byId).forEach(([id, toolbarConfig]) => {
        page.toolbars.configureById(id, toolbarConfig);
      });
    }

    // By Type
    if (config.toolbars.byType) {
      Object.entries(config.toolbars.byType).forEach(([type, toolbarConfig]) => {
        page.toolbars.configureByType(type, toolbarConfig);
      });
    }

    // By Tag
    if (config.toolbars.byTag) {
      Object.entries(config.toolbars.byTag).forEach(([tag, toolbarConfig]) => {
        page.toolbars.configureByTag(tag, toolbarConfig);
      });
    }

    // Default
    if (config.toolbars.default) {
      page.toolbars.setGlobalDefault(config.toolbars.default);
    }
  }

  // Event system
  const eventListeners: Record<string, Function[]> = {};

  const on = (event: string, callback: Function) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event]!.push(callback);
  };

  const off = (event: string, callback: Function) => {
    if (eventListeners[event]) {
      eventListeners[event] = eventListeners[event]!.filter(cb => cb !== callback);
    }
  };

  const emit = (event: string, ...args: any[]) => {
    if (eventListeners[event]) {
      eventListeners[event]!.forEach(callback => callback(...args));
    }
  };

  // UI Configuration
  const uiConfig = {
    showSidebar: config.ui?.showSidebar !== false,
    sidebarWidth: config.ui?.sidebarWidth || 300,
    showStats: config.ui?.showStats !== false,
  };

  // Build editor UI
  const editorHTML = `
    <div style="display: flex; height: 100vh; font-family: var(--font-main);">
      ${uiConfig.showSidebar ? `
        <div id="supertab-sidebar" style="width: ${uiConfig.sidebarWidth}px; background: var(--color-sidemenu-bg); border-right: 1px solid var(--color-primary-border); padding: 1rem; overflow-y: auto;">
          <h2 style="margin: 0 0 1rem 0; font-family: var(--font-secondary);">SuperTab Editor</h2>
          
          ${uiConfig.showStats ? `
            <div style="margin-bottom: 1.5rem;">
              <h3 style="font-size: 0.9rem; margin-bottom: 0.5rem;">Page Stats</h3>
              <div style="font-size: 0.85rem; color: #666;">
                <div>Components: ${page.components.count()}</div>
                <div>Styles: ${page.styles.count()}</div>
                <div>Assets: ${page.assets.count()}</div>
              </div>
            </div>
          ` : ''}

          <div id="supertab-selected" style="display: none; background: white; padding: 1rem; border-radius: 6px;">
            <h3 style="font-size: 0.9rem; margin: 0 0 0.5rem 0;">Selected Component</h3>
            <div id="supertab-component-info" style="font-size: 0.85rem;"></div>
          </div>
        </div>
      ` : ''}

      <div style="flex: 1; overflow: auto; background: #f5f5f5; padding: 2rem;">
        <iframe id="supertab-iframe" style="width: 100%; height: 100%; border: none; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);"></iframe>
      </div>
    </div>
  `;

  container.innerHTML = editorHTML;

  // Get iframe element
  const iframe = document.getElementById('supertab-iframe') as HTMLIFrameElement;
  if (!iframe) {
    throw new Error('Failed to create iframe');
  }

  // Build iframe content with proper sandboxing
  const iframeContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.getTitle()}</title>
  <style>${page.getCSS()}</style>
  <style>
    /* WYSIWYG editing styles */
    .supertab-highlight {
      outline: 2px dashed var(--color-editor-light-text, #212C3E) !important;
      outline-offset: 2px;
      cursor: pointer !important;
      position: relative !important;
    }
    .supertab-highlight:hover {
      outline: 2px solid var(--color-editor-light-text, #212C3E) !important;
      background-color: rgba(33, 44, 62, 0.05) !important;
    }
    .supertab-selected {
      outline: 3px solid #10b981 !important;
      background-color: rgba(16, 185, 129, 0.1) !important;
    }
    .supertab-context-toolbar {
      position: absolute;
      top: -42px;
      left: 0;
      background: white;
      border: 2px solid var(--color-editor-light-text, #212C3E);
      border-radius: 6px;
      padding: 0.4rem;
      display: flex;
      gap: 0.3rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      z-index: 9999;
    }
    .toolbar-action {
      background: white;
      border: 1px solid var(--color-primary-border, #e5e7eb);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      white-space: nowrap;
      font-family: var(--font-main);
      transition: all 0.2s;
    }
    .toolbar-action:hover {
      background: var(--color-editor-light-bg, #EDF0F5);
      border-color: var(--color-editor-light-text, #212C3E);
    }
    .toolbar-action.danger:hover {
      background: #fee;
      border-color: #ef4444;
      color: #ef4444;
    }
  </style>
</head>
${page.getHTML()}
<script>
  let selectedElement = null;

  // Initialize WYSIWYG
  function initWYSIWYG() {
    document.querySelectorAll('[id]').forEach(el => {
      if (!el.id || el.id.startsWith('supertab-')) return;

      el.classList.add('supertab-highlight');
      
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectElement(el);
      });
    });
  }

  function selectElement(el) {
    // Clear previous selection
    if (selectedElement) {
      selectedElement.classList.remove('supertab-selected');
      const oldToolbar = selectedElement.querySelector('.supertab-context-toolbar');
      if (oldToolbar) oldToolbar.remove();
    }

    // Highlight new selection
    selectedElement = el;
    el.classList.add('supertab-selected');

    // Notify parent
    window.parent.postMessage({
      type: 'supertab:componentSelected',
      id: el.id,
      tagName: el.tagName.toLowerCase(),
      className: el.className
    }, '*');

    // Show toolbar
    showToolbar(el);
  }

  function showToolbar(el) {
    // Request toolbar config from parent
    window.parent.postMessage({
      type: 'supertab:getToolbar',
      id: el.id
    }, '*');
  }

  // Listen for toolbar config from parent
  window.addEventListener('message', (event) => {
    if (event.data.type === 'supertab:toolbarConfig') {
      renderToolbar(event.data.config, event.data.elementId);
    } else if (event.data.type === 'supertab:toolbarAction') {
      handleToolbarAction(event.data.action, event.data.elementId);
    }
  });

  function renderToolbar(toolbarConfig, elementId) {
    const el = document.getElementById(elementId);
    if (!el || !toolbarConfig.enabled) return;

    // Create toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'supertab-context-toolbar';

    // Add buttons
    const enabledActions = toolbarConfig.actions.filter(a => a.enabled);
    enabledActions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = 'toolbar-action' + (action.danger ? ' danger' : '');
      btn.textContent = action.icon + ' ' + action.label;
      btn.onclick = () => {
        window.parent.postMessage({
          type: 'supertab:toolbarAction',
          action: action.id,
          elementId: elementId
        }, '*');
      };
      toolbar.appendChild(btn);
    });

    el.appendChild(toolbar);
  }

  function handleToolbarAction(action, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (action === 'delete') {
      el.remove();
    }
  }

  // Initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWYSIWYG);
  } else {
    initWYSIWYG();
  }
</script>
</html>`;

  // Load content into iframe
  iframe.srcdoc = iframeContent;

  // Store references
  const sidebar = document.getElementById('supertab-sidebar') as HTMLElement | undefined;
  const canvas = iframe;

  // Handle messages from iframe
  let selectedComponent: Component | null = null;

  window.addEventListener('message', (event) => {
    if (event.data.type === 'supertab:componentSelected') {
      const component = page.components.findById(event.data.id);
      if (component) {
        selectedComponent = component;

        // Update sidebar
        if (sidebar) {
          const info = document.getElementById('supertab-component-info');
          const selectedDiv = document.getElementById('supertab-selected');
          if (info && selectedDiv) {
            info.innerHTML = `
              <div><strong>ID:</strong> ${event.data.id}</div>
              <div><strong>Tag:</strong> ${event.data.tagName}</div>
            `;
            selectedDiv.style.display = 'block';
          }
        }

        // Emit event
        emit('componentSelect', component);
        if (config.onComponentSelect) {
          config.onComponentSelect(component);
        }
      }
    } else if (event.data.type === 'supertab:getToolbar') {
      // Send toolbar config to iframe
      const component = page.components.findById(event.data.id);
      if (component) {
        const toolbarConfig = page.toolbars.getToolbarForComponent(component);
        iframe.contentWindow?.postMessage({
          type: 'supertab:toolbarConfig',
          config: toolbarConfig,
          elementId: event.data.id
        }, '*');
      }
    } else if (event.data.type === 'supertab:toolbarAction') {
      handleToolbarAction(event.data.action, event.data.elementId);
    }
  });

  // Handle toolbar actions
  function handleToolbarAction(actionId: string, elementId: string) {
    const component = page.components.findById(elementId);
    if (!component) return;

    switch (actionId) {
      case 'edit':
        emit('componentEdit', component);
        if (config.onComponentEdit) {
          config.onComponentEdit(component);
        }
        break;

      case 'editJS':
        // Will be handled by Monaco editor integration
        emit('componentEditJS', component);
        break;

      case 'duplicate':
        const clone = JSON.parse(JSON.stringify(component));
        clone.attributes = clone.attributes || {};
        clone.attributes.id = elementId + '-copy-' + Date.now();
        page.components.addComponent(clone);
        
        emit('componentDuplicate', component, clone);
        if (config.onComponentDuplicate) {
          config.onComponentDuplicate(component, clone);
        }
        
        refresh();
        break;

      case 'delete':
        page.components.removeComponent(elementId);
        
        emit('componentDelete', component);
        if (config.onComponentDelete) {
          config.onComponentDelete(component);
        }
        
        // Notify iframe to remove element
        iframe.contentWindow?.postMessage({
          type: 'supertab:toolbarAction',
          action: 'delete',
          elementId: elementId
        }, '*');
        break;
    }
  }

  // Refresh iframe
  function refresh() {
    const newContent = iframe.srcdoc?.replace(
      /<body>.*<\/body>/s,
      `${page.getHTML()}<script>/* WYSIWYG reinit */</script>`
    );
    if (newContent) {
      iframe.srcdoc = newContent;
    } else {
      // Full reload
      iframe.srcdoc = iframe.srcdoc || '';
    }
  }

  // Save page data
  function save(): string {
    return page.toJSON();
  }

  // Destroy editor
  function destroy() {
    container.innerHTML = '';
    // Clear event listeners
    Object.keys(eventListeners).forEach(key => {
      eventListeners[key] = [];
    });
  }

  // Return SuperTabEditor instance
  return {
    page,
    on,
    off,
    refresh,
    save,
    destroy,
    elements: {
      container: container!,
      sidebar,
      canvas,
      iframe,
    }
  };
}
