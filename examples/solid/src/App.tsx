import { onCleanup, onMount } from 'solid-js';
import { SQLocal } from 'sqlocal';
import {
  createCustomComponentDefinition,
  createPageMeta,
  init,
  syncFrontendWithServer,
  type Component,
  type FrontendSyncStatus,
  type InitConfig,
  type PageData,
  type PagesRenderProps,
  type ServerFile,
  type ServerPageMeta,
  type ServerSyncAdapter,
} from '../../../index';
import AppShell from './AppShell';

const componentsData: PageData = {
  title: 'Solid + Cloudflare Workers',
  item_id: 0,
  body: {
    assets: [],
    components: [
      {
        type: 'box',
        attributes: {
          id: 'solid-root',
        },
        components: [
          { type: 'text', content: 'Hello from Solid!', attributes: { id: 'solid-text' } },
          { type: 'hero', attributes: { id: 'hero-1' } },
        ],
      },
    ],
    styles: [
      {
        selectors: [{ name: 'solid-root' }],
        style: {
          'min-height': '200px',
          'background-color': 'white',
          'font-family': 'sans-serif',
          'font-size': '16px',
          padding: '1rem',
          margin: '0',
        },
      },
    ],
  },
};

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
              padding: '2rem',
              'background-color': '#f5f5f5',
            },
          },
        ],
      },
    },
  ],
  activePageIndex: 0,
};

export default function App() {
  let editor: ReturnType<typeof init> | null = null;

  onMount(() => {
    console.log('App mounted');
    const sqlocalClient = new SQLocal('editorts.sqlite');

    const editorConfig: InitConfig = {
      storage: {
        type: 'sqlocal',
        client: sqlocalClient,
      },
      initialStorageKey: 'solid-page',
      iframeId: 'preview-iframe',
      data: multiPageData,
      codeEditor: {
        provider: 'textarea',
      },
      toolbars: {
        byType: {
          box: {
            enabled: true,
            actions: [
              { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
              { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true },
            ],
          },
        },
      },
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
      ui: {
        stats: { containerId: 'stats-container', enabled: true },
        layers: { containerId: 'layers-container', enabled: true },
        pages: {
          containerId: 'pages-container',
          enabled: true,
          render: ({ container, pages, activePageIndex, onSelect }: PagesRenderProps) => {
            container.innerHTML = pages
              .map((page: PageData, index: number) => {
                const label = page.title?.trim() ? page.title.trim() : `Page ${index + 1}`;
                const isActive = index === activePageIndex;
                return `<button type="button" data-page-index="${index}" style="margin-right:0.25rem; padding:0.25rem 0.5rem; ${isActive ? 'background:#4f46e5; color:white;' : ''}">${label}</button>`;
              })
              .join('');

            container.querySelectorAll('[data-page-index]').forEach((button: Element) => {
              button.addEventListener('click', () => {
                const index = Number((button as HTMLElement).dataset.pageIndex);
                if (Number.isFinite(index)) {
                  onSelect(index);
                }
              });
            });
          },
        },
        componentPalette: { containerId: 'component-palette', enabled: true },
        selectedInfo: { containerId: 'selected-info', enabled: true },
        editors: {
          files: { containerId: 'files-viewer-container', enabled: true },
          viewer: { containerId: 'viewer-editor-container', enabled: true },
          js: { containerId: 'js-editor-container', enabled: true },
          css: { containerId: 'css-editor-container', enabled: true },
          json: { containerId: 'json-editor-container', enabled: true },
          jsx: { containerId: 'jsx-editor-container', enabled: true },
        },
        viewTabs: {
          editorButtonId: 'tab-editor',
          codeButtonId: 'tab-code',
          defaultView: 'editor',
        },
        codeTabs: {
          filesButtonId: 'code-tab-files',
          viewerButtonId: 'code-tab-viewer',
          jsButtonId: 'code-tab-js',
          cssButtonId: 'code-tab-css',
          jsonButtonId: 'code-tab-json',
          jsxButtonId: 'code-tab-jsx',
          defaultTab: 'files',
        },
        commandPalette: {
          containerId: 'command-palette',
          inputId: 'command-palette-input',
          resultsId: 'command-palette-results',
          closeButtonId: 'command-palette-close',
          hintId: 'command-palette-hint',
          shortcuts: [
            {
              key: 'mod+p',
              action: () => {
                const input = document.getElementById('command-palette-input') as HTMLInputElement | null;
                input?.focus();
              },
            },
          ],
          enabled: true,
        },
      },
      onComponentSelect: (component: Component) => {
        console.log('Selected:', component.attributes?.id);
      },
    };

    editor = init(editorConfig);

    const quickstartServerAdapter: ServerSyncAdapter = {
      listPages: async (): Promise<ServerPageMeta[]> => {
        return [
          {
            key: 'solid-page',
            updatedAt: Date.now(),
          },
        ];
      },
      listFiles: async (): Promise<ServerFile[]> => {
        return [
          {
            path: 'page.json',
            content: editor?.save() ?? '',
          },
          {
            path: 'styles.css',
            content: editor?.page.getCSS() ?? '',
          },
          {
            path: 'index.html',
            content: `<!DOCTYPE html><html><head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>${editor?.page.getHTML() ?? ''}</html>`,
          },
        ];
      },
      saveFiles: async (pageKey: string, files: ServerFile[]): Promise<void> => {
        console.log('Sync upload (mock):', pageKey, files.length, 'files');
      },
    };

    void syncFrontendWithServer({
      pageKey: 'solid-page',
      storage: editor.storage.getAdapter(),
      adapter: quickstartServerAdapter,
      includeFiles: (path: string) => path !== 'meta',
      onStatus: (status: FrontendSyncStatus) => {
        console.log('Sync status:', status.state);
      },
    });

    const pageMeta = createPageMeta('solid-page', editor.page.toObject());
    console.log('Page meta:', pageMeta);

    (window as unknown as { editor?: typeof editor }).editor = editor;
  });

  onCleanup(() => {
    editor?.destroy();
  });

  return <AppShell />;
}
