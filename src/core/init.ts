/**
 * SuperTab Editor Initialization
 * Users control the layout - init() just populates their containers
 */

import { Page } from './Page';
import type { InitConfig, SuperTabEditor, Component } from '../types';

/**
 * Initialize SuperTab Editor
 * User creates the HTML structure, init() populates it
 */
export function init(config: InitConfig): SuperTabEditor {
  // Get the iframe element (required)
  const iframe = document.getElementById(config.iframeId) as HTMLIFrameElement;
  if (!iframe || iframe.tagName !== 'IFRAME') {
    throw new Error(`Iframe element #${config.iframeId} not found or is not an iframe`);
  }

  // Create Page instance
  const page = new Page(config.data);

  // Configure toolbars from config
  if (config.toolbars) {
    if (config.toolbars.byId) {
      Object.entries(config.toolbars.byId).forEach(([id, toolbarConfig]) => {
        page.toolbars.configureById(id, toolbarConfig);
      });
    }

    if (config.toolbars.byType) {
      Object.entries(config.toolbars.byType).forEach(([type, toolbarConfig]) => {
        page.toolbars.configureByType(type, toolbarConfig);
      });
    }

    if (config.toolbars.byTag) {
      Object.entries(config.toolbars.byTag).forEach(([tag, toolbarConfig]) => {
        page.toolbars.configureByTag(tag, toolbarConfig);
      });
    }

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

  // Get optional UI containers
  const sidebarContainer = config.ui?.sidebar?.containerId 
    ? document.getElementById(config.ui.sidebar.containerId) 
    : null;
  
  const statsContainer = config.ui?.stats?.containerId
    ? document.getElementById(config.ui.stats.containerId)
    : null;
  
  const selectedInfoContainer = config.ui?.selectedInfo?.containerId
    ? document.getElementById(config.ui.selectedInfo.containerId)
    : null;

  // Populate stats if container provided
  if (statsContainer && config.ui?.stats?.enabled !== false) {
    statsContainer.innerHTML = `
      <div style="font-size: 0.85rem;">
        <div>Components: ${page.components.count()}</div>
        <div>Styles: ${page.styles.count()}</div>
        <div>Assets: ${page.assets.count()}</div>
      </div>
    `;
  }

  // Build iframe content with WYSIWYG
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

    // Request toolbar config
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

    const toolbar = document.createElement('div');
    toolbar.className = 'supertab-context-toolbar';

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

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWYSIWYG);
  } else {
    initWYSIWYG();
  }
</script>
</html>`;

  // Load content into iframe
  iframe.srcdoc = iframeContent;

  // Handle messages from iframe
  window.addEventListener('message', (event) => {
    if (event.data.type === 'supertab:componentSelected') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update selected info container if provided
        if (selectedInfoContainer && config.ui?.selectedInfo?.enabled !== false) {
          selectedInfoContainer.innerHTML = `
            <div><strong>ID:</strong> ${event.data.id}</div>
            <div><strong>Tag:</strong> ${event.data.tagName}</div>
          `;
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
    iframe.srcdoc = iframeContent;
  }

  // Save page data
  function save(): string {
    return page.toJSON();
  }

  // Destroy editor
  function destroy() {
    iframe.srcdoc = '';
    if (sidebarContainer) sidebarContainer.innerHTML = '';
    if (statsContainer) statsContainer.innerHTML = '';
    if (selectedInfoContainer) selectedInfoContainer.innerHTML = '';
    
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
      iframe,
      sidebar: sidebarContainer || undefined,
      stats: statsContainer || undefined,
      selectedInfo: selectedInfoContainer || undefined,
    }
  };
}
