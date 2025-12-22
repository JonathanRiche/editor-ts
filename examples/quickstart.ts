/**
 * QuickStart Example - Configure SuperTab Editor
 * This file shows how to use the SuperTab library to create an editor
 */

import { Page, toolbarPresets } from '../index';
import sampleData from '../samples/page_template.json';

// Load page from JSON
const page = new Page(JSON.stringify(sampleData));

// ==================== CONFIGURE TOOLBARS (Runtime Only) ====================
// Configure toolbars for different components - NOT saved to JSON

// Configure toolbar by component ID
page.toolbars.configureById('iydl', {
  enabled: true,
  actions: [
    { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
    { id: 'editJS', label: 'Edit JS', icon: '📜', enabled: true },
    { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true },
    { id: 'delete', label: 'Delete', icon: '🗑️', enabled: true, danger: true },
  ]
});

// Configure all custom-code components
page.toolbars.configureByType('custom-code', {
  enabled: true,
  actions: [
    { id: 'edit', label: 'Edit', icon: '✏️', enabled: false },
    { id: 'editJS', label: 'Edit Code', icon: '📜', enabled: true },
    { id: 'duplicate', label: 'Clone', icon: '📋', enabled: true },
    { id: 'delete', label: 'Delete', icon: '🗑️', enabled: true, danger: true },
  ]
});

// Use preset for box components
page.toolbars.configureByType('box', toolbarPresets.editOnly);

// ==================== RENDER EDITOR ====================

const root = document.getElementById('root');

if (root) {
  // Create editor container
  const editorHTML = `
    <div style="display: flex; height: 100vh; font-family: var(--font-main);">
      <!-- Sidebar -->
      <div id="sidebar" style="width: 300px; background: var(--color-sidemenu-bg); border-right: 1px solid var(--color-primary-border); padding: 1rem; overflow-y: auto;">
        <h2 style="margin: 0 0 1rem 0;">SuperTab Editor</h2>
        
        <div style="margin-bottom: 1.5rem;">
          <h3 style="font-size: 0.9rem; margin-bottom: 0.5rem;">Page Stats</h3>
          <div style="font-size: 0.85rem; color: #666;">
            <div>Components: ${page.components.count()}</div>
            <div>Styles: ${page.styles.count()}</div>
            <div>Assets: ${page.assets.count()}</div>
          </div>
        </div>

        <div id="selectedComponent" style="display: none; background: white; padding: 1rem; border-radius: 6px;">
          <h3 style="font-size: 0.9rem; margin: 0 0 0.5rem 0;">Selected</h3>
          <div id="componentInfo" style="font-size: 0.85rem;"></div>
        </div>
      </div>

      <!-- Canvas -->
      <div style="flex: 1; overflow: auto; background: #f5f5f5; padding: 2rem;">
        <div id="canvas" style="background: white; min-height: 100%;">
          ${page.getHTML()}
        </div>
      </div>
    </div>
  `;

  root.innerHTML = editorHTML;

  // Inject page CSS
  const style = document.createElement('style');
  style.textContent = page.getCSS();
  document.head.appendChild(style);

  // ==================== WYSIWYG ====================
  
  const canvas = document.getElementById('canvas');
  let selectedElement: HTMLElement | null = null;

  function initWYSIWYG() {
    const elements = canvas?.querySelectorAll('[id]');
    
    elements?.forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (!htmlEl.id) return;

      // Style for editing
      htmlEl.style.position = 'relative';
      htmlEl.style.outline = '2px dashed var(--color-editor-light-text, #212C3E)';
      htmlEl.style.outlineOffset = '2px';
      htmlEl.style.cursor = 'pointer';

      // Click handler
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectComponent(htmlEl);
      });

      // Hover
      htmlEl.addEventListener('mouseenter', () => {
        if (htmlEl !== selectedElement) {
          htmlEl.style.backgroundColor = 'rgba(33, 44, 62, 0.05)';
        }
      });

      htmlEl.addEventListener('mouseleave', () => {
        if (htmlEl !== selectedElement) {
          htmlEl.style.backgroundColor = '';
        }
      });
    });
  }

  async function selectComponent(el: HTMLElement) {
    // Clear previous
    if (selectedElement) {
      selectedElement.style.outline = '2px dashed var(--color-editor-light-text, #212C3E)';
      selectedElement.style.backgroundColor = '';
      
      // Remove old toolbar
      const oldToolbar = selectedElement.querySelector('#context-toolbar');
      if (oldToolbar) oldToolbar.remove();
    }

    // Highlight
    selectedElement = el;
    el.style.outline = '3px solid #10b981';
    el.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';

    // Update sidebar
    const componentInfo = document.getElementById('componentInfo');
    const selectedDiv = document.getElementById('selectedComponent');
    
    if (componentInfo && selectedDiv) {
      componentInfo.innerHTML = `
        <div><strong>ID:</strong> ${el.id}</div>
        <div><strong>Tag:</strong> ${el.tagName.toLowerCase()}</div>
      `;
      selectedDiv.style.display = 'block';
    }

    // Show toolbar
    const component = page.components.findById(el.id);
    console.log('Component found:', component ? 'YES' : 'NO', 'ID:', el.id);
    
    if (component) {
      const toolbarConfig = page.toolbars.getToolbarForComponent(component);
      console.log('Toolbar config:', toolbarConfig);
      
      if (toolbarConfig.enabled) {
        console.log('Creating toolbar with', toolbarConfig.actions.length, 'actions');
        const toolbar = document.createElement('div');
        toolbar.id = 'context-toolbar';
        toolbar.style.cssText = `
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
        `;

        // Add buttons
        const enabledActions = toolbarConfig.actions.filter(a => a.enabled);
        enabledActions.forEach(action => {
          const btn = document.createElement('button');
          btn.textContent = `${action.icon} ${action.label}`;
          btn.style.cssText = `
            background: white;
            border: 1px solid var(--color-primary-border, #e5e7eb);
            padding: 0.5rem 0.75rem;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85rem;
            white-space: nowrap;
            font-family: var(--font-main);
          `;
          
          btn.onclick = () => handleAction(action.id, el);
          toolbar.appendChild(btn);
        });

        el.appendChild(toolbar);
        console.log('✓ Toolbar appended to element:', el.id);
      } else {
        console.log('⚠️ Toolbar disabled for component:', el.id);
      }
    } else {
      console.log('❌ Component not found in page data for ID:', el.id);
    }
  }

  function handleAction(actionId: string, el: HTMLElement) {
    console.log('Action:', actionId, 'on', el.id);
    
    if (actionId === 'edit') {
      alert(`Edit: ${el.id}`);
    } else if (actionId === 'editJS') {
      alert(`Edit JS: ${el.id}\n(Monaco editor coming soon)`);
    } else if (actionId === 'duplicate') {
      if (confirm(`Duplicate ${el.id}?`)) {
        const comp = page.components.findById(el.id);
        if (comp) {
          const clone = JSON.parse(JSON.stringify(comp));
          clone.attributes = clone.attributes || {};
          clone.attributes.id = el.id + '-copy';
          page.components.addComponent(clone);
          alert('Duplicated!');
        }
      }
    } else if (actionId === 'delete') {
      if (confirm(`Delete ${el.id}?`)) {
        page.components.removeComponent(el.id);
        el.remove();
        alert('Deleted!');
      }
    }
  }

  // Initialize
  initWYSIWYG();

  console.log('✓ SuperTab Editor Ready');
  console.log('✓ Click any element to see the toolbar!');
}
