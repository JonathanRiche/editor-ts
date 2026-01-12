/**
 * QuickStart Example - Simple EditorTs Editor Setup
 * User controls the layout in index.html, init() populates it
 */

import { init, type PageData } from '../index';
import sampleData from '../samples/page_template.json';

console.log('QuickStart script loaded');

const default_data: PageData = {
  title: "New Page",
  item_id: 0,
  body: {
    html: "",
    css: "",
    assets: [],
    components: [
    ],
    styles: []
  }
}


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
          { id: 'editCSS', label: 'Edit CSS', icon: '🎨', enabled: true },
          { id: 'editJSON', label: 'Edit JSON', icon: '🧱', enabled: true },
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
    },
    layers: {
      containerId: 'layers-container',
      enabled: true
    },
    editors: {
      js: {
        containerId: 'js-editor-container',
        enabled: true,
      },
      css: {
        containerId: 'css-editor-container',
        enabled: true,
      },
      json: {
        containerId: 'json-editor-container',
        enabled: true,
      },
    },
    viewTabs: {
      editorButtonId: 'tab-editor',
      codeButtonId: 'tab-code',
      defaultView: 'editor',
    },
  },

  // Optional: built-in editor provider.
  // Note: 'modern-monaco' requires the host app to install modern-monaco.
  codeEditor: {
    provider: 'modern-monaco',
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


console.log('✅ EditorTs Editor initialized!');
console.log('💡 Click any element in the canvas to see the toolbar');
console.log('💡 Access editor.page for full API');
