/**
 * QuickStart Example - Simple EditorTs Editor Setup
 * User controls the layout in index.html, init() populates it
 */

import { init, type PageData, type Component } from '../index';
import { createOpencodeClient } from '@opencode-ai/sdk';
// import sampleData from '../samples/page_template.json';

console.log('QuickStart script loaded');

const componentsData: PageData = {
  title: "Components example",
  item_id: 0,
  body: {
    assets: [],
    components: [
      {
        type: "box",
        attributes: {
          id: "box-1",
        },
        components: [
          { type: "text", content: "Hello World!", attributes: { id: "text-1" } }
        ]
      }
    ],
    styles: [
      {
        selectors: [
          { name: "box-1" }
        ],
        style: {
          "min-height": "200px",
          "background-color": "white",
          "font-family": "sans-serif",
          "font-size": "16px",
          "padding": "1rem",
          "margin": "0",
        }
      }
    ]
  }
}

const htmlOnlyData: PageData = {
  title: 'HTML-only example',
  item_id: 0,
  body: {
    html: '<body><div id="html-only-root"><h1 id="html-only-title">Hello from HTML-only</h1></div></body>',
    css: '',
    assets: [],
    styles: [],
  },
};


const aiBaseUrlInput = document.getElementById('ai-base-url') as HTMLInputElement | null;

// Initialize the editor - user controls layout in index.html
const editor = init({
  // Required: The iframe element ID (user creates this in HTML)
  iframeId: 'preview-iframe',

  // Required: Page data (clean JSON)
  // To test HTML->components conversion, use `htmlOnlyData`.
  data: htmlOnlyData,

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
      jsx: {
        containerId: 'jsx-editor-container',
        enabled: true,
      },
    },
    viewTabs: {
      editorButtonId: 'tab-editor',
      codeButtonId: 'tab-code',
      defaultView: 'editor',
    },
    codeTabs: {
      defaultTab: 'js',
      jsButtonId: 'code-tab-js',
      cssButtonId: 'code-tab-css',
      jsonButtonId: 'code-tab-json',
      jsxButtonId: 'code-tab-jsx',
    },
  },

  // Optional: built-in editor provider.
  // Note: 'modern-monaco' requires the host app to install modern-monaco.
  codeEditor: {
    provider: 'modern-monaco',
  },

  // Optional: AI provider
  // Demonstrates passing a user-created OpenCode client instance.
  aiProvider: {
    provider: 'opencode',
    mode: 'client',
    baseUrl: aiBaseUrlInput?.value ?? 'http://localhost:4096',
    client: createOpencodeClient({ baseUrl: aiBaseUrlInput?.value ?? 'http://localhost:4096' }),
  },

  // Optional: Event callbacks
  onComponentSelect: (component: Component) => {
    console.log('🎯 Selected:', component.attributes?.id);

    // Show selected section
    const selectedContainer = document.getElementById('selected-container');
    if (selectedContainer) {
      selectedContainer.classList.add('active');
    }
  },

  onComponentEdit: (component: Component) => {
    console.log('✏️ Edit:', component.attributes?.id);
    alert(`Edit component: ${component.attributes?.id}`);
  },

  onComponentDuplicate: (original: Component, duplicate: Component) => {
    console.log('📋 Duplicated:', original.attributes?.id, '→', duplicate.attributes?.id);
    alert(`Duplicated!\nNew ID: ${duplicate.attributes?.id}`);
  },

  onComponentDelete: (component: Component) => {
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
editor.on('componentSelect', (component) => {
  console.log('Custom handler:', component.attributes?.id);
});

// Find all custom-code components
const customCode = editor.page.components.findByType('custom-code');
console.log('📜 Custom code components:', customCode.length);

// Set up save button


const aiHealthButton = document.getElementById('ai-health-btn') as HTMLButtonElement | null;
const aiHealthStatus = document.getElementById('ai-health-status') as HTMLElement | null;


if (aiHealthButton && aiHealthStatus) {
  aiHealthButton.addEventListener('click', async () => {
    if (!editor.ai) {
      aiHealthStatus.textContent = 'AI provider is disabled.';
      return;
    }

    aiHealthStatus.textContent = 'Checking...';

    try {
      const client = await editor.ai.getClient();
      const result = await client.config.get();
      aiHealthStatus.textContent = JSON.stringify(result.data ?? result, null, 2);
    } catch (err: unknown) {
      aiHealthStatus.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}


console.log('✅ EditorTs Editor initialized!');
console.log('💡 Click any element in the canvas to see the toolbar');
console.log('💡 Access editor.page for full API');
