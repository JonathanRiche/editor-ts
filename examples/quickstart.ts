/**
 * QuickStart Example - Simple EditorTs Editor Setup
 * User controls the layout in index.html, init() populates it
 */

import {
  init,
  createCustomComponentDefinition,
  createPageMeta,
  syncFrontendWithServer,
  type PageData,
  type Component,
  type PagesRenderProps,
  type InitConfig,
  type ServerSyncAdapter,
  type ServerPageMeta,
  type ServerFile,
} from '../index';
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
const editorConfig: InitConfig = {
  storage: {
    type: 'local',
    prefix: 'quickstart_',
  },

  initialStorageKey: 'quickstart-page',
  // Required: The iframe element ID (user creates this in HTML)
  iframeId: 'preview-iframe',

  versionControl: {
    enabled: true,
    maxSnapshots: 100,
  },

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
      render: ({ container, pages, activePageIndex, onSelect }: PagesRenderProps) => {
        container.innerHTML = pages
          .map((page, index) => {
            const label = page.title?.trim() ? page.title.trim() : `Page ${index + 1}`;
            const isActive = index === activePageIndex;
            return `<button type="button" data-page-index="${index}" style="margin-right:0.25rem; padding:0.25rem 0.5rem; ${isActive ? 'background:#4f46e5; color:white;' : ''}">${label}</button>`;
          })
          .join('');

        container.querySelectorAll('[data-page-index]').forEach((button) => {
          button.addEventListener('click', () => {
            const index = Number((button as HTMLElement).dataset.pageIndex);
            if (Number.isFinite(index)) {
              onSelect(index);
            }
          });
        });
      },
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

      baseUrlInputId: 'ai-base-url',
      healthButtonId: 'ai-health-btn',
      healthStatusId: 'ai-health-status',

      sessionSelectId: 'ai-session-select',
      modelSelectId: 'ai-model-select',
      sessionNewButtonId: 'ai-session-new',

      inputId: 'ai-chat-input',
      sendButtonId: 'ai-chat-send',
      applyButtonId: 'ai-chat-apply',
      logId: 'ai-chat-log',

      link: {
        anchorId: 'ai-chat-link',
        enabled: true,
      },

      autoApply: true,
      stream: { enabled: true },
      enabled: true,
    },

    autoSave: {
      progressBarId: 'auto-save-bar',
      enabled: true,
    },
    commandPalette: {
      containerId: 'command-palette',
      inputId: 'command-palette-input',
      resultsId: 'command-palette-results',
      closeButtonId: 'command-palette-close',
      hintId: 'command-palette-hint',
      shortcuts: [
        {
          key: 'mod+k',
          action: () => {
            const input = document.getElementById('command-palette-input') as HTMLInputElement | null;
            input?.focus();
          },
        },
      ],
      items: [
        {
          title: 'Reset canvas zoom',
          type: 'command',
          action: () => {
            document.documentElement.style.zoom = '1';
          },
        },
      ],
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

  // Optional: Auto-save demo (saves every 1 edits)
  autoSave: {
    enabled: true,
    everyEdits: 1,
    key: 'quickstart-page',
  },

  // macOS users can override mod key to meta.
  shortcutConfig: {
    modKey: navigator.platform.includes('Mac') ? 'meta' : 'ctrl',
  },

  // Optional: AI provider
  // Demonstrates passing a user-created OpenCode client instance.
  aiProvider: {
    provider: 'opencode',
    mode: 'client',
    // Point at the local server proxy by default (avoids CORS+BasicAuth preflight).
    baseUrl: `${window.location.origin}/opencode`,
    stream: { enabled: true },

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

    // Hide selected section
    const selectedContainer = document.getElementById('selected-container');
    if (selectedContainer) {
      selectedContainer.classList.remove('active');
    }
  }
};

const editor = init(editorConfig);

const quickstartServerAdapter: ServerSyncAdapter = {
  listPages: async (): Promise<ServerPageMeta[]> => {
    return [
      {
        key: 'quickstart-page',
        updatedAt: Date.now(),
      },
    ];
  },
  listFiles: async (): Promise<ServerFile[]> => {
    return [
      {
        path: 'page.json',
        content: editor.save(),
      },
      {
        path: 'styles.css',
        content: editor.page.getCSS() ?? '',
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html><html><head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>${editor.page.getHTML()}</html>`,
      },
    ];
  },
  saveFiles: async (pageKey: string, files: ServerFile[]): Promise<void> => {
    console.log('Sync upload (mock):', pageKey, files.length, 'files');
  },
};

void syncFrontendWithServer({
  pageKey: 'quickstart-page',
  storage: editor.storage.getAdapter(),
  adapter: quickstartServerAdapter,
  includeFiles: (path) => path !== 'meta',
  onStatus: (status) => {
    console.log('Sync status:', status.state);
  },
});

const pageMeta = createPageMeta('quickstart-page', editor.page.toObject());
console.log('🗂️ Page meta:', pageMeta);

// ==================== USE THE EDITOR INSTANCE ====================

// Expose for debugging
(window as unknown as { editor?: typeof editor }).editor = editor;

// Access the Page API
console.log('📄 Page title:', editor.page.getTitle());
console.log('📊 Total components:', editor.page.components.count());

// Add custom event listener
editor.on('componentSelect', (component) => {
  console.log('Custom handler:', component.attributes?.id);
});

// Undo/Redo controls
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement | null;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement | null;

const syncHistoryButtons = () => {
  if (!editor.versionControl) {
    undoBtn?.toggleAttribute('disabled', true);
    redoBtn?.toggleAttribute('disabled', true);
    return;
  }

  undoBtn?.toggleAttribute('disabled', !editor.versionControl.canUndo());
  redoBtn?.toggleAttribute('disabled', !editor.versionControl.canRedo());
};

// Keep buttons updated when edits happen.
editor.on('textUpdate', () => syncHistoryButtons());
editor.on('componentInsert', () => syncHistoryButtons());
editor.on('componentDelete', () => syncHistoryButtons());
editor.on('componentDuplicate', () => syncHistoryButtons());
editor.on('componentReorder', () => syncHistoryButtons());

// Style edits are applied via UI (not currently an event), so keep buttons fresh.
const styleRoot = document.getElementById('selected-info');
styleRoot?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('[data-editorts-action="apply-style"], [data-editorts-action="clear-style"], [data-editorts-action="save-css"], [data-editorts-action="save-json"], [data-editorts-action="save-js"]')) {
    // Allow async commit to finish.
    setTimeout(syncHistoryButtons, 250);
  }
});

if (undoBtn) {
  undoBtn.addEventListener('click', async () => {
    if (!editor.versionControl) return;
    await editor.versionControl.undo();
    syncHistoryButtons();
  });
}

if (redoBtn) {
  redoBtn.addEventListener('click', async () => {
    if (!editor.versionControl) return;
    await editor.versionControl.redo();
    syncHistoryButtons();
  });
}

syncHistoryButtons();

// Find all custom-code components
const customCode = editor.page.components.findByType('custom-code');
console.log('📜 Custom code components:', customCode.length);

// Set up save button



console.log('✅ EditorTs Editor initialized!');
console.log('💡 Click any element in the canvas to see the toolbar');
console.log('💡 Access editor.page for full API');
