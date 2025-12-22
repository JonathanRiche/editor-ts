/**
 * QuickStart Example - Simple SuperTab Editor Setup
 * This demonstrates how easy it is to use the init() function
 */

import { init } from '../index';
import sampleData from '../samples/page_template.json';

console.log('QuickStart script loaded');
console.log('Root element:', document.getElementById('root'));

try {
  console.log('Calling init()...');
  
  // Initialize the editor with one function call!
  const editor = init({
  // Required: where to mount the editor
  containerId: 'root',
  
  // Required: the page data
  data: sampleData as any,
  
  // Optional: Configure toolbars (runtime only, not saved to JSON)
  toolbars: {
    // Configure specific components by ID
    byId: {
      'iydl': {
        enabled: true,
        actions: [
          { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
          { id: 'editJS', label: 'Edit JS', icon: '📜', enabled: true },
          { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true },
          { id: 'delete', label: 'Delete', icon: '🗑️', enabled: false, danger: true },
        ]
      },
      'step2': {
        enabled: false,
        actions: []
      }
    },
    
    // Configure all components of a certain type
    byType: {
      'custom-code': {
        enabled: true,
        actions: [
          { id: 'edit', label: 'Edit', icon: '✏️', enabled: false },
          { id: 'editJS', label: 'Edit Code', icon: '📜', enabled: true },
          { id: 'duplicate', label: 'Clone', icon: '📋', enabled: true },
          { id: 'delete', label: 'Delete', icon: '🗑️', enabled: true, danger: true },
        ]
      },
      'box': {
        enabled: true,
        actions: [
          { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
          { id: 'duplicate', label: 'Copy', icon: '📋', enabled: true },
        ]
      }
    }
  },
  
  // Optional: UI configuration
  ui: {
    showSidebar: true,
    sidebarWidth: 300,
    showStats: true
  },
  
  // Optional: Event callbacks
  onComponentSelect: (component) => {
    console.log('🎯 Component selected:', component.attributes?.id);
  },
  
  onComponentEdit: (component) => {
    console.log('✏️ Edit component:', component.attributes?.id);
    alert(`Edit component: ${component.attributes?.id}`);
  },
  
  onComponentDuplicate: (original, duplicate) => {
    console.log('📋 Duplicated:', original.attributes?.id, '→', duplicate.attributes?.id);
    alert(`Component duplicated!\nNew ID: ${duplicate.attributes?.id}`);
  },
  
  onComponentDelete: (component) => {
    console.log('🗑️ Deleted component:', component.attributes?.id);
    alert(`Component deleted: ${component.attributes?.id}`);
  }
});

// ==================== USE THE EDITOR INSTANCE ====================

// Access the page data
console.log('📄 Page title:', editor.page.getTitle());
console.log('📊 Components:', editor.page.components.count());

// Add custom event listeners after init
editor.on('componentSelect', (component: any) => {
  console.log('Custom handler - selected:', component);
});

// Use the Page API directly
editor.page.components.findByType('custom-code').forEach((comp: any) => {
  console.log('Found custom-code component:', comp.attributes?.id);
});

// Save the page
const saveBtn = document.createElement('button');
saveBtn.textContent = '💾 Save Page';
saveBtn.style.cssText = `
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 1rem 2rem;
  background: var(--color-editor-light-text, #212C3E);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: var(--font-main);
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  z-index: 10000;
`;
saveBtn.onclick = () => {
  const json = editor.save();
  console.log('Saved JSON (clean, no toolbar configs):', json.substring(0, 100) + '...');
  
  // Verify no toolbar in JSON
  const hasToolbar = json.includes('"toolbar"');
  console.log('Contains toolbar in JSON?', hasToolbar ? '❌ YES' : '✅ NO');
  
  alert('Page saved! Check console for JSON output.');
};
document.body.appendChild(saveBtn);

  console.log('✅ SuperTab Editor initialized!');
  console.log('💡 Click any element in the canvas to see the toolbar');
  console.log('💡 Use editor.page to access the Page API');
  console.log('💡 Use editor.on() to add custom event listeners');
  
} catch (error) {
  console.error('❌ Failed to initialize SuperTab:', error);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding: 2rem; color: red;">Error: ${error}</div>`;
  }
}
