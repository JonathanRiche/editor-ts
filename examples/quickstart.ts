/**
 * QuickStart Example - Simple EditorTs Editor Setup
 * User controls the layout in index.html, init() populates it
 */

import { init, createCustomComponentDefinition, type PageData, type Component } from '../index';
// import sampleData from '../samples/page_template.json';

console.log('QuickStart script loaded');

const aiBaseUrlInput = document.getElementById('ai-base-url') as HTMLInputElement | null;
const aiPasswordInput = document.getElementById('ai-password') as HTMLInputElement | null;


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
          { type: "text", content: "Hello World!", attributes: { id: "text-1" } },
          { type: 'hero', attributes: { id: 'hero-1' } }
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

const multiPageData = {
  pages: [
    componentsData,
    {
      title: 'Second page',
      item_id: 1,
      body: {
        assets: [],
        components: [
          {
            type: 'box',
            attributes: { id: 'page2-root' },
            components: [
              { type: 'text', tagName: 'h2', attributes: { id: 'page2-title' }, content: 'Second page title' },
              { type: 'text', attributes: { id: 'page2-body' }, content: 'This is another page.' },
            ],
          },
        ],
        styles: [
          {
            selectors: [{ name: 'page2-root' }],
            style: {
              'min-height': '200px',
              'padding': '2rem',
              'background-color': '#f5f5f5',
            },
          },
        ],
      },
    },
  ],
  activePageIndex: 0,
};

// const htmlOnlyData: PageData = {
//   title: 'HTML-only example',
//   item_id: 0,
//   body: {
//     html: '<body><div id="html-only-root"><h1 id="html-only-title">Hello from HTML-only</h1></div></body>',
//     css: '',
//     assets: [],
//     styles: [],
//   },
// };


// Initialize the editor - user controls layout in index.html
const editor = init({
  // Required: The iframe element ID (user creates this in HTML)
  iframeId: 'preview-iframe',

  // Required: Page data (clean JSON)
  // To test HTML->components conversion, use `htmlOnlyData`.
  data: multiPageData,

  // Optional: Custom components
  customComponents: {
    hero: createCustomComponentDefinition({
      type: 'hero',
      label: 'Hero',
      iconSvg:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 10h10"/><path d="M4 14h16"/><path d="M4 18h10"/></svg>',
      factory: () => ({
        type: 'hero',
        tagName: 'section',
        attributes: { id: 'hero-1', class: 'hero' },
        components: [
          { type: 'text', tagName: 'h1', attributes: { id: 'hero-title' }, content: 'Hero Title' },
          { type: 'text', tagName: 'p', attributes: { id: 'hero-subtitle' }, content: 'Hero subtitle text' },
        ],
      }),
    }),
  },

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
    pages: {
      containerId: 'pages-container',
      enabled: true,
    },
    componentPalette: {
      containerId: 'component-palette',
      enabled: true,
    },
    editors: {
      files: {
        containerId: 'files-viewer-container',
        enabled: true,
      },
      viewer: {
        containerId: 'viewer-editor-container',
        enabled: true,
      },
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
      defaultTab: 'files',
      filesButtonId: 'code-tab-files',
      viewerButtonId: 'code-tab-viewer',
      jsButtonId: 'code-tab-js',
      cssButtonId: 'code-tab-css',
      jsonButtonId: 'code-tab-json',
      jsxButtonId: 'code-tab-jsx',
    },

    aiChat: {
      rootId: 'ai-chat-root',
      expandButtonId: 'ai-chat-expand',
      expandedClassName: 'editorts-ai-chat-expanded',
      collapsedClassName: 'editorts-ai-chat-collapsed',
      defaultExpanded: false,
      enabled: true,
    },
  },

  // Optional: built-in editor provider.
  // Note: 'modern-monaco' requires the host app to install modern-monaco.
  codeEditor: {
    provider: 'modern-monaco',
    workspace: {
      enabled: true,
      name: 'quickstart',
    },
  },

  // Optional: AI provider
  // Demonstrates passing a user-created OpenCode client instance.
  aiProvider: {
    provider: 'opencode',
    mode: 'client',
    // Point at the local server proxy by default (avoids CORS+BasicAuth preflight).
    baseUrl: `${window.location.origin}/opencode`,

    // If you want direct-to-opencode (no proxy), set baseUrl to the server URL and
    // supply credentials via the dev server env vars.
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


const aiChatInput = document.getElementById('ai-chat-input') as HTMLTextAreaElement | null;
const aiChatSend = document.getElementById('ai-chat-send') as HTMLButtonElement | null;
const aiChatApply = document.getElementById('ai-chat-apply') as HTMLButtonElement | null;
const aiChatLog = document.getElementById('ai-chat-log') as HTMLElement | null;

let lastAiReplacements: Array<{ path: string; content: string }> | null = null;

const appendChatLog = (label: string, text: string) => {
  if (!aiChatLog) return;
  aiChatLog.textContent = `${aiChatLog.textContent ?? ''}${label}: ${text}\n\n`;
};


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

if (aiChatSend && aiChatInput) {
  aiChatSend.addEventListener('click', async () => {
    if (!editor.ai) {
      appendChatLog('error', 'AI provider is disabled.');
      return;
    }

    const prompt = aiChatInput.value.trim();
    if (!prompt) return;

    appendChatLog('user', prompt);

    try {
      const result = await editor.ai.chat(prompt);

      appendChatLog('assistant', result.rawText);

      lastAiReplacements = result.replacements;
      aiChatApply?.toggleAttribute('disabled', lastAiReplacements.length === 0);
    } catch (err: unknown) {
      appendChatLog('error', err instanceof Error ? err.message : String(err));
    }
  });
}

if (aiChatApply) {
  aiChatApply.addEventListener('click', async () => {
    if (!lastAiReplacements || lastAiReplacements.length === 0) return;

    if (!editor.ai) {
      appendChatLog('error', 'AI provider is disabled.');
      return;
    }

    try {
      await editor.ai.apply(lastAiReplacements);
      appendChatLog('apply', `Applied ${lastAiReplacements.length} replacement(s).`);
    } catch (err: unknown) {
      appendChatLog('error', err instanceof Error ? err.message : String(err));
    }
  });
}


console.log('✅ EditorTs Editor initialized!');
console.log('💡 Click any element in the canvas to see the toolbar');
console.log('💡 Access editor.page for full API');
