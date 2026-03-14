import { createSignal, onCleanup, onMount } from 'solid-js';
import { SQLocal } from 'sqlocal';
import {
  JsonContentAdapter,
  ProjectFilesystemAdapter,
  createHttpProjectProvider,
  createCustomComponentDefinition,
  init,
  type Component,
  type ContentAdapter,
  type InitConfig,
  type PageData,
  type PagesRenderProps,
  type ProjectFilesystemProvider,
} from '../../../index';
import AppShell from './AppShell';

type SupportedDiffLanguage =
  | 'css'
  | 'json'
  | 'html'
  | 'jsx'
  | 'tsx'
  | 'typescript'
  | 'javascript'
  | 'text'
  | undefined;

type DiffsModule = {
  FileDiff: new (options?: {
    diffStyle?: 'unified' | 'split';
    overflow?: 'scroll' | 'wrap';
    themeType?: 'system' | 'light' | 'dark';
  }) => {
    render(args: {
      oldFile?: { name: string; contents: string; lang?: SupportedDiffLanguage };
      newFile?: { name: string; contents: string; lang?: SupportedDiffLanguage };
      containerWrapper?: HTMLElement;
    }): void;
    cleanUp(): void;
  };
};

type FsFileHandle = {
  kind: 'file';
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

type FsDirectoryHandle = {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterable<[string, FsEntryHandle]>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FsDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>;
};

type FsEntryHandle = FsFileHandle | FsDirectoryHandle;

type DirectoryPickerHost = {
  showDirectoryPicker?: () => Promise<FsDirectoryHandle>;
};

const DEMO_STORAGE_KEY = 'solid-hosted-review';
const REMOTE_WORKSPACE_URL = '/api/project';
const AI_BASE_URL_STORAGE_KEY = 'editorts:solid:ai-base-url';
const DEFAULT_AI_BASE_URL = 'http://127.0.0.1:4096';
const AI_DIFF_VIEWER_ID = 'ai-diff-viewer';
const AI_DIFF_SUMMARY_ID = 'ai-diff-summary';

const landingPage: PageData = {
  title: 'Hosted review shell',
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
          {
            type: 'text',
            tagName: 'h1',
            attributes: { id: 'solid-headline' },
            content: 'Review in the cloud. Edit with local AI.',
          },
          {
            type: 'text',
            tagName: 'p',
            attributes: { id: 'solid-body' },
            content: 'This demo keeps hosted review simple, then lets you attach a local folder and a local OpenCode server when you want real project edits.',
          },
          { type: 'hero', attributes: { id: 'hero-1' } },
        ],
      },
    ],
    styles: [
      {
        selectors: [{ name: 'solid-root' }],
        style: {
          'min-height': '240px',
          'background-color': '#fffdf7',
          'font-family': 'Georgia, serif',
          color: '#1f2937',
          padding: '2rem',
          margin: '0',
          display: 'flex',
          'flex-direction': 'column',
          gap: '1rem',
        },
      },
      {
        selectors: [{ name: 'solid-headline' }],
        style: {
          'font-size': 'clamp(2rem, 5vw, 3.5rem)',
          'line-height': '1.05',
          margin: '0',
          color: '#111827',
        },
      },
      {
        selectors: [{ name: 'solid-body' }],
        style: {
          'max-width': '44rem',
          'font-size': '1.05rem',
          'line-height': '1.6',
          margin: '0',
        },
      },
    ],
  },
};

const demoData = {
  pages: [
    landingPage,
    {
      title: 'Connected workflow',
      item_id: 1,
      body: {
        assets: [],
        components: [
          {
            type: 'box',
            attributes: { id: 'workflow-root' },
            components: [
              {
                type: 'text',
                tagName: 'h2',
                attributes: { id: 'workflow-title' },
                content: 'Recommended user flow',
              },
              {
                type: 'text',
                attributes: { id: 'workflow-body' },
                content: '1. Open the hosted app. 2. Connect a Chromium folder. 3. Run a local OpenCode server with CORS enabled. 4. Ask AI to update real files.',
              },
            ],
          },
        ],
        styles: [
          {
            selectors: [{ name: 'workflow-root' }],
            style: {
              'min-height': '220px',
              padding: '2rem',
              'background-color': '#eef6ff',
              color: '#0f172a',
            },
          },
        ],
      },
    },
  ],
  activePageIndex: 0,
};

const normalizePath = (path: string): string => path.replace(/^\.\//, '').replace(/\\/g, '/');

const getDirectoryPickerHost = (): DirectoryPickerHost => {
  return window as unknown as DirectoryPickerHost;
};

const supportsDirectoryPicker = (): boolean => {
  return typeof getDirectoryPickerHost().showDirectoryPicker === 'function';
};

const createFolderProvider = (root: FsDirectoryHandle): ProjectFilesystemProvider => {
  const cache = new Map<string, FsFileHandle>();

  const walk = async (dir: FsDirectoryHandle, prefix = ''): Promise<string[]> => {
    const out: string[] = [];

    for await (const [name, handle] of dir.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        const nested = await walk(handle as FsDirectoryHandle, path);
        out.push(...nested);
      } else {
        cache.set(path, handle as FsFileHandle);
        out.push(path);
      }
    }

    return out;
  };

  const getFileHandle = async (path: string, create: boolean): Promise<FsFileHandle | null> => {
    const cleanPath = normalizePath(path);
    if (!cleanPath) return null;

    const cached = cache.get(cleanPath);
    if (cached) return cached;

    const parts = cleanPath.split('/').filter((part) => part.length > 0);
    if (parts.length === 0) return null;

    let dir = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!;
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch {
        if (!create) return null;
        throw new Error(`Failed to access directory ${part} for path ${cleanPath}`);
      }
    }

    const fileName = parts[parts.length - 1]!;
    try {
      const handle = await dir.getFileHandle(fileName, { create });
      cache.set(cleanPath, handle);
      return handle;
    } catch {
      if (!create) return null;
      throw new Error(`Failed to access file ${fileName} for path ${cleanPath}`);
    }
  };

  return {
    listFiles: async () => {
      const paths = await walk(root);
      return paths.map(normalizePath).sort((a, b) => a.localeCompare(b));
    },
    readFile: async (path: string) => {
      const handle = await getFileHandle(path, false);
      if (!handle) return null;
      const file = await handle.getFile();
      return file.text();
    },
    writeFile: async (path: string, content: string) => {
      const handle = await getFileHandle(path, true);
      if (!handle) {
        throw new Error(`Could not resolve writable file handle for ${path}`);
      }

      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },
  };
};

const ensureSeedFiles = async (fs: ProjectFilesystemProvider): Promise<void> => {
  const files = await fs.listFiles();
  const hasPageJson = files.includes('page.json');
  const hasHtml = files.some((file) => file === 'index.html' || file === 'src/index.html');
  const hasCss = files.some((file) => file === 'styles.css' || file === 'src/styles.css' || file === 'src/index.css');

  if (!hasPageJson && !hasHtml) {
    await fs.writeFile(
      'index.html',
      '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>EditorTs Hosted Demo</title><link rel="stylesheet" href="styles.css" /></head><body><main id="app-root"><h1 id="title">Connected project</h1><p id="body">This folder is now the source of truth for EditorTs.</p></main></body></html>'
    );
  }

  if (!hasCss) {
    await fs.writeFile(
      'styles.css',
      'body { margin: 0; font-family: Georgia, serif; background: #fffdf7; color: #111827; }\n#app-root { max-width: 820px; margin: 0 auto; padding: 3rem 1.5rem; }\n#title { font-size: clamp(2.2rem, 6vw, 4rem); margin: 0 0 0.75rem; }\n#body { max-width: 42rem; line-height: 1.65; }'
    );
  }
};

const loadStoredAiBaseUrl = (): string => {
  if (typeof window === 'undefined') return DEFAULT_AI_BASE_URL;
  const stored = window.localStorage.getItem(AI_BASE_URL_STORAGE_KEY)?.trim();
  return stored && stored.length > 0 ? stored : DEFAULT_AI_BASE_URL;
};

const inferDiffLanguage = (path: string): SupportedDiffLanguage => {
  const normalized = normalizePath(path).toLowerCase();

  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.html')) return 'html';
  if (normalized.endsWith('.jsx')) return 'jsx';
  if (normalized.endsWith('.tsx')) return 'tsx';
  if (normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) return 'javascript';

  return 'text';
};

export default function App() {
  let editor: ReturnType<typeof init> | null = null;
  let sqlocalClient: SQLocal | null = null;
  let diffInstances: Array<{ cleanUp(): void }> = [];
  let diffsModulePromise: Promise<DiffsModule> | null = null;

  const [fsSupported, setFsSupported] = createSignal(false);
  const [workspaceMode, setWorkspaceMode] = createSignal<'demo' | 'remote' | 'folder'>('demo');
  const [folderName, setFolderName] = createSignal<string | null>(null);
  const [statusText, setStatusText] = createSignal('Loading hosted review workspace...');
  const [aiBaseUrl, setAiBaseUrl] = createSignal(DEFAULT_AI_BASE_URL);

  const createHeroDefinition = () => {
    return createCustomComponentDefinition({
      type: 'hero',
      label: 'Hero',
      iconSvg:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 10h10"/><path d="M4 14h16"/><path d="M4 18h10"/></svg>',
      factory: () => {
        const stamp = Date.now();
        return {
          type: 'hero',
          tagName: 'section',
          attributes: { id: `hero-${stamp}`, class: 'hero' },
          components: [
            { type: 'text', tagName: 'h1', attributes: { id: `hero-title-${stamp}` }, content: 'Hero Title' },
            { type: 'text', tagName: 'p', attributes: { id: `hero-subtitle-${stamp}` }, content: 'Hero subtitle text' },
          ],
        };
      },
    });
  };

  const buildEditorConfig = (adapter: ContentAdapter, options: { reviewMode: boolean }): InitConfig => {
    if (!sqlocalClient) {
      throw new Error('SQLocal is not initialized yet.');
    }

    return {
      iframeId: 'preview-iframe',
      data: demoData,
      content: { adapter },
      storage: {
        type: 'sqlocal',
        client: sqlocalClient,
      },
      codeEditor: {
        provider: 'textarea',
      },
      autoSave: options.reviewMode
        ? {
            enabled: true,
            everyEdits: 1,
            key: DEMO_STORAGE_KEY,
          }
        : undefined,
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
        hero: createHeroDefinition(),
      },
      aiProvider: {
        provider: 'opencode',
        mode: 'client',
        baseUrl: aiBaseUrl(),
        stream: { enabled: true },
      },
      ui: {
        stats: { containerId: 'stats-container', enabled: true },
        layers: { containerId: 'layers-container', enabled: true },
        selectedInfo: { containerId: 'selected-info', enabled: true },
        pages: {
          containerId: 'pages-container',
          enabled: true,
          render: ({ container, pages, activePageIndex, onSelect }: PagesRenderProps) => {
            container.innerHTML = pages
              .map((page: PageData, index: number) => {
                const label = page.title?.trim() ? page.title.trim() : `Page ${index + 1}`;
                const isActive = index === activePageIndex;
                return `<button type="button" data-page-index="${index}" style="margin-right:0.35rem; margin-bottom:0.35rem; padding:0.45rem 0.7rem; border-radius:999px; border:1px solid rgba(15,23,42,0.12); ${isActive ? 'background:#0f172a; color:white;' : 'background:white; color:#0f172a;'}">${label}</button>`;
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
        aiChat: {
          rootId: 'ai-chat-root',
          inputId: 'ai-chat-input',
          sendButtonId: 'ai-chat-send',
          applyButtonId: 'ai-chat-apply',
          logId: 'ai-chat-log',
          statusId: 'ai-chat-status',
          sessionListId: 'ai-session-list',
          modelSelectId: 'ai-model-select',
          sessionNewButtonId: 'ai-session-new',
          sessionResetButtonId: 'ai-session-reset',
          healthButtonId: 'ai-health-btn',
          healthStatusId: 'ai-health-status',
          baseUrlInputId: 'ai-base-url',
          autoApply: false,
          stream: { enabled: true },
          link: {
            anchorId: 'ai-chat-link',
            path: '/chats',
            enabled: true,
          },
          enabled: true,
        },
        commandPalette: {
          containerId: 'command-palette',
          inputId: 'command-palette-input',
          resultsId: 'command-palette-results',
          closeButtonId: 'command-palette-close',
          hintId: 'command-palette-hint',
          enabled: true,
        },
      },
      onComponentSelect: (component: Component) => {
        const componentId = component.attributes?.id ? ` ${component.attributes.id}` : '';
        setStatusText(`Selected${componentId}.`);
      },
    };
  };

  const getDiffsModule = async (): Promise<DiffsModule> => {
    diffsModulePromise ??= import('../node_modules/@pierre/diffs/dist/components/FileDiff.js') as Promise<DiffsModule>;
    return diffsModulePromise;
  };

  const setAiDiffSummary = (text: string): void => {
    const summary = document.getElementById(AI_DIFF_SUMMARY_ID);
    if (summary) {
      summary.textContent = text;
    }
  };

  const clearRenderedDiffs = (): void => {
    diffInstances.forEach((instance) => {
      instance.cleanUp();
    });
    diffInstances = [];
  };

  const setAiDiffEmptyState = (message: string, summary = 'Awaiting AI changes'): void => {
    const viewer = document.getElementById(AI_DIFF_VIEWER_ID);
    if (!viewer) return;

    clearRenderedDiffs();
    viewer.innerHTML = '';

    const empty = document.createElement('div');
    empty.dataset.aiDiffEmpty = 'true';
    empty.className = 'flex min-h-[200px] items-center justify-center rounded-sm border border-dashed border-line-soft bg-bg-input/40 px-4 text-center font-mono text-[11px] leading-relaxed text-text-muted';
    empty.textContent = message;
    viewer.appendChild(empty);
    setAiDiffSummary(summary);
  };

  const renderAiDiffPreview = async (
    instance: ReturnType<typeof init>,
    replacements: Array<{ path: string; content: string }>,
  ): Promise<void> => {
    const viewer = document.getElementById(AI_DIFF_VIEWER_ID);
    if (!viewer) return;

    clearRenderedDiffs();
    viewer.innerHTML = '';

    if (replacements.length === 0) {
      setAiDiffEmptyState('The last reply did not include editable file replacements.', 'No pending changes');
      return;
    }

    const { FileDiff } = await getDiffsModule();

    const resolved = await Promise.all(
      replacements.map(async (replacement) => ({
        path: replacement.path,
        before: (await instance.content.adapter.readFile(replacement.path)) ?? '',
        after: replacement.content,
        lang: inferDiffLanguage(replacement.path),
      })),
    );

    for (const file of resolved) {
      const wrapper = document.createElement('div');
      wrapper.className = 'ai-diff-file';
      viewer.appendChild(wrapper);

      const diff = new FileDiff({
        diffStyle: 'unified',
        overflow: 'wrap',
        themeType: 'dark',
      });

      diff.render({
        oldFile: {
          name: file.path,
          contents: file.before,
          lang: file.lang,
        },
        newFile: {
          name: file.path,
          contents: file.after,
          lang: file.lang,
        },
        containerWrapper: wrapper,
      });

      diffInstances.push(diff);
    }

    setAiDiffSummary(`${resolved.length} pending change${resolved.length === 1 ? '' : 's'}`);
  };

  const installAiDiffPreview = (instance: ReturnType<typeof init>): void => {
    const ai = instance.ai;
    if (!ai) {
      setAiDiffEmptyState('AI is disabled for this workspace.', 'AI unavailable');
      return;
    }

    const originalChat = ai.chat.bind(ai);
    const originalApply = ai.apply.bind(ai);
    const originalSetCurrent = ai.sessions.setCurrent.bind(ai.sessions);
    const originalReset = ai.sessions.reset.bind(ai.sessions);

    ai.chat = async (prompt, options) => {
      const result = await originalChat(prompt, options);
      await renderAiDiffPreview(instance, result.replacements);
      return result;
    };

    ai.apply = async (replacements) => {
      await originalApply(replacements);
      setAiDiffEmptyState(
        replacements.length > 0
          ? `Applied ${replacements.length} change${replacements.length === 1 ? '' : 's'}. Generate another reply to preview the next patch.`
          : 'Generate a reply with file replacements to inspect it here before applying.',
        replacements.length > 0 ? 'Applied' : 'Awaiting AI changes',
      );
    };

    ai.sessions.setCurrent = async (sessionId) => {
      await originalSetCurrent(sessionId);
      setAiDiffEmptyState(
        'Select or generate a reply in this session to preview its file changes.',
        sessionId ? 'Session loaded' : 'Awaiting AI changes',
      );
    };

    ai.sessions.reset = async () => {
      await originalReset();
      setAiDiffEmptyState(
        'Generate a reply with file replacements to inspect it here before applying.',
        'Awaiting AI changes',
      );
    };
  };

  const initializeWorkspace = async (args: {
    adapter: ContentAdapter;
    mode: 'demo' | 'remote' | 'folder';
    status: string;
    folderName?: string | null;
    loadFromAdapter?: boolean;
    restoreReviewSnapshot?: boolean;
  }): Promise<void> => {
    if (editor) {
      clearRenderedDiffs();
      editor.destroy();
      editor = null;
    }

    editor = init(buildEditorConfig(args.adapter, { reviewMode: args.mode === 'demo' }));
    installAiDiffPreview(editor);
    setAiDiffEmptyState(
      'Generate a reply with file replacements to inspect it here before applying.',
      'Awaiting AI changes',
    );

    if (args.restoreReviewSnapshot) {
      const loaded = await editor.loadFrom(DEMO_STORAGE_KEY);
      if (!loaded) {
        await editor.content.save();
      }
    }

    if (args.loadFromAdapter) {
      await editor.content.load();
    }

    setWorkspaceMode(args.mode);
    setFolderName(args.folderName ?? null);
    setStatusText(args.status);

    (window as unknown as { editor?: ReturnType<typeof init> }).editor = editor;
  };

  const initializeDemoWorkspace = async (): Promise<void> => {
    setStatusText('Loading hosted review workspace...');
    await initializeWorkspace({
      adapter: new JsonContentAdapter(demoData),
      mode: 'demo',
      status: 'Hosted review workspace ready. Edits persist locally with SQLocal.',
      restoreReviewSnapshot: true,
    });
  };

  const initializeRemoteWorkspace = async (): Promise<void> => {
    setStatusText('Connecting to the same-origin remote workspace...');

    const fs = createHttpProjectProvider({
      baseUrl: new URL(REMOTE_WORKSPACE_URL, window.location.origin).toString(),
    });

    await initializeWorkspace({
      adapter: new ProjectFilesystemAdapter({
        fs,
        loadStrategy: 'page-json',
        save: {
          writePageJson: true,
          writeHtml: false,
          writeCss: false,
          writeComponentScripts: false,
        },
      }),
      mode: 'remote',
      loadFromAdapter: true,
      status: 'Remote workspace connected. Files now round-trip through the hosted app API and can persist to Cloudflare D1.',
    });
  };

  const connectFolder = async (): Promise<void> => {
    if (!supportsDirectoryPicker()) {
      setStatusText('Folder access requires a Chromium browser with the File System Access API.');
      return;
    }

    try {
      setStatusText('Opening local folder picker...');
      const picker = getDirectoryPickerHost().showDirectoryPicker;
      if (!picker) {
        setStatusText('Directory picker is unavailable in this browser.');
        return;
      }

      const root = await picker();
      const provider = createFolderProvider(root);
      await ensureSeedFiles(provider);

      const adapter = new ProjectFilesystemAdapter({
        fs: provider,
        loadStrategy: 'auto',
        save: {
          writeHtml: true,
          writeCss: true,
          writeComponentScripts: true,
          writePageJson: false,
        },
      });

      await initializeWorkspace({
        adapter,
        mode: 'folder',
        folderName: root.name,
        loadFromAdapter: true,
        status: `Local folder connected. EditorTs is now reading and writing real files in ${root.name}.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('abort')) {
        setStatusText('Folder selection cancelled.');
      } else {
        setStatusText(`Failed to connect folder: ${message}`);
      }
    }
  };

  const handleAiBaseUrlChange = (value: string): void => {
    setAiBaseUrl(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AI_BASE_URL_STORAGE_KEY, value);
    }
  };

  onMount(() => {
    sqlocalClient = new SQLocal('editorts.sqlite');
    setFsSupported(supportsDirectoryPicker());
    setAiBaseUrl(loadStoredAiBaseUrl());
    void initializeDemoWorkspace();
  });

  onCleanup(() => {
    clearRenderedDiffs();
    editor?.destroy();
  });

  return (
    <AppShell
      fsSupported={fsSupported()}
      workspaceMode={workspaceMode()}
      folderName={folderName()}
      statusText={statusText()}
      aiBaseUrl={aiBaseUrl()}
      onAiBaseUrlChange={handleAiBaseUrlChange}
      onConnectFolder={() => {
        void connectFolder();
      }}
      onUseRemoteWorkspace={() => {
        void initializeRemoteWorkspace();
      }}
      onUseDemoWorkspace={() => {
        void initializeDemoWorkspace();
      }}
    />
  );
}
