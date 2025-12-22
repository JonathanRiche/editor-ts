/**
 * QuickStart Example - Simple EditorTs Editor Setup
 * User controls the layout in index.html, init() populates it
 */

import { init } from '../index';
import sampleData from '../samples/page_template.json';

console.log('QuickStart script loaded');

// Initialize the editor - user controls layout in index.html
const editor = init({
  // Required: The iframe element ID (user creates this in HTML)
  iframeId: 'preview-iframe',
  
  // Required: Page data (clean JSON)
  data: sampleData as any,
  
  // Optional: Configure toolbars (runtime only, NOT saved to JSON)
  toolbars: {
    byId: {
      'iydl': {
        enabled: true,
        actions: [
          { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
          { id: 'editJS', label: 'Edit JS', icon: '📜', enabled: true },
          { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true },
          { id: 'delete', label: 'Delete', icon: '🗑️', enabled: false, danger: true },
        ]
      }
    },
    
    byType: {
      'custom-code': {
        enabled: true,
        actions: [
          { id: 'editJS', label: 'Edit Code', icon: '📜', enabled: true },
          { id: 'duplicate', label: 'Clone', icon: '📋', enabled: true },
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
  
  // Optional: UI containers (user created these in HTML)
  ui: {
    stats: {
      containerId: 'stats-container',
      enabled: true
    },
    selectedInfo: {
      containerId: 'selected-info',
      enabled: true
    }
  },
  
  // Optional: Event callbacks
  onComponentSelect: (component: any) => {
    console.log('🎯 Selected:', component.attributes?.id);
    
    // Show selected section
    const selectedContainer = document.getElementById('selected-container');
    if (selectedContainer) {
      selectedContainer.classList.add('active');
    }
  },
  
  onComponentEdit: (component: any) => {
    console.log('✏️ Edit:', component.attributes?.id);
    alert(`Edit component: ${component.attributes?.id}`);
  },
  
  onComponentDuplicate: (original: any, duplicate: any) => {
    console.log('📋 Duplicated:', original.attributes?.id, '→', duplicate.attributes?.id);
    alert(`Duplicated!\nNew ID: ${duplicate.attributes?.id}`);
  },
  
  onComponentDelete: (component: any) => {
    console.log('🗑️ Deleted:', component.attributes?.id);
    alert(`Deleted: ${component.attributes?.id}`);
    
    // Hide selected section
    const selectedContainer = document.getElementById('selected-container');
    if (selectedContainer) {
      selectedContainer.classList.remove('active');
    }
  }
});

// ==================== USE THE EDITOR INSTANCE ====================

// Access the Page API
console.log('📄 Page title:', editor.page.getTitle());
console.log('📊 Total components:', editor.page.components.count());

// Add custom event listener
editor.on('componentSelect', (component: any) => {
  console.log('Custom handler:', component.attributes?.id);
});

// Find all custom-code components
const customCode = editor.page.components.findByType('custom-code');
console.log('📜 Custom code components:', customCode.length);

// Set up save button
const saveBtn = document.getElementById('save-btn');
if (saveBtn) {
  saveBtn.style.display = 'block';
  saveBtn.onclick = () => {
    const json = editor.save();
    console.log('💾 Saved JSON (first 100 chars):', json.substring(0, 100) + '...');
    
    // Verify JSON is clean (no toolbar configs)
    const hasToolbar = json.includes('"toolbar"');
    console.log('Contains "toolbar" in JSON?', hasToolbar ? '❌ YES' : '✅ NO');
    
    // Download the JSON
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'page-export.json';
    a.click();
    URL.revokeObjectURL(url);
    
    alert('✓ Page saved and downloaded!');
  };
}

console.log('✅ EditorTs Editor initialized!');
console.log('💡 Click any element in the canvas to see the toolbar');
console.log('💡 Access editor.page for full API');
