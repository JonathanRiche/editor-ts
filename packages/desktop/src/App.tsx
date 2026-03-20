import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  createCustomComponentDefinition,
  init,
  ProjectFilesystemAdapter,
  type ProjectFilesystemProvider,
  type ProjectFilesystemPermissionReply,
  type ProjectFilesystemPermissionRequest,
  type Component,
  type InitConfig,
  type PagesRenderProps,
} from 'editor-ts';
import { SHARED_AI_UI_IDS } from '@editorts/starter-shared/aiIds';
import {
  installAiDiffPreview,
  loadStoredAiBaseUrl,
  persistAiBaseUrl,
  setAiDiffEmptyState,
} from '@editorts/starter-shared/aiRuntime';
import AppShell from './AppShell';
import {
  createNativeProjectProvider,
  deleteNativeDesktopStoragePage,
  defaultHttpApiBaseUrl,
  fetchNativeDesktopState,
  isNativeDesktopRuntime,
  loadNativeDesktopStoragePage,
  openNativeProjectDirectory,
  persistNativeDesktopSetting,
  persistNativeRecentProject,
  saveNativeDesktopStoragePage,
  type DesktopRecentProject,
} from './desktopNativeRpc';
import { measureRendererAsync, recordRendererPerf } from './rendererPerf';

type FsMode = 'browser-folder' | 'server-routes';

type FsFileHandle = {
  kind: 'file';
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

type FsDirectoryHandle = {
  kind: 'directory';
  name?: string;
  entries: () => AsyncIterable<[string, FsEntryHandle]>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FsDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>;
};

type FsEntryHandle = FsFileHandle | FsDirectoryHandle;

type DirectoryPickerHost = {
  showDirectoryPicker?: () => Promise<FsDirectoryHandle>;
};

type DesktopNativeSettings = {
  aiBaseUrl?: string | null;
  aiDirectory?: string | null;
  previewBaseUrl?: string | null;
  lastProjectRoot?: string | null;
};

const AI_BASE_URL_STORAGE_KEY = 'editorts:filesystem-solid:ai-base-url';
const AI_DIRECTORY_STORAGE_KEY = 'editorts:filesystem-solid:ai-directory';
const DEFAULT_DIRECT_AI_BASE_URL = 'http://127.0.0.1:4096';

const defaultAiBaseUrl = (): string => {
  if (typeof window === 'undefined') return DEFAULT_DIRECT_AI_BASE_URL;

  const origin = window.location.origin;
  if (origin.startsWith('http://') || origin.startsWith('https://')) {
    return `${origin}/opencode`;
  }

  return DEFAULT_DIRECT_AI_BASE_URL;
};

const normalizePath = (path: string): string => path.replace(/^\.\//, '').replace(/\\/g, '/');

const DESKTOP_CANVAS_WEBVIEW_PRELOAD = `
window.__EDITORTS_CANVAS_POST_MESSAGE__ = (message) => {
  window.__electrobunSendToHost(message);
};

document.addEventListener('keydown', (event) => {
  window.__electrobunSendToHost({
    type: 'editorts:webviewKeydown',
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  });
}, true);
`.trim();

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');
const sanitizeSessionNamespaceSegment = (value: string): string => {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
};

const loadStoredValue = (storageKey: string, fallback = ''): string => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(storageKey)?.trim();
  return stored && stored.length > 0 ? stored : fallback;
};

const persistStoredValue = (storageKey: string, value: string): void => {
  if (typeof window === 'undefined') return;
  const trimmed = value.trim();
  if (!trimmed) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, trimmed);
};

const getDirectoryPickerHost = (): DirectoryPickerHost => {
  return window as unknown as DirectoryPickerHost;
};

const supportsDirectoryPicker = (): boolean => {
  return typeof getDirectoryPickerHost().showDirectoryPicker === 'function';
};

const buildApiUrl = (baseUrl: string, endpoint: string, params?: Record<string, string>): string => {
  const base = trimTrailingSlash(baseUrl.trim());
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(base ? `${base}${path}` : path, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
};

const parseDesktopNativeSettings = (value: unknown): DesktopNativeSettings => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    aiBaseUrl: typeof record.aiBaseUrl === 'string' ? record.aiBaseUrl : null,
    aiDirectory: typeof record.aiDirectory === 'string' ? record.aiDirectory : null,
    previewBaseUrl: typeof record.previewBaseUrl === 'string' ? record.previewBaseUrl : null,
    lastProjectRoot: typeof record.lastProjectRoot === 'string' ? record.lastProjectRoot : null,
  };
};

const parseDesktopRecentProjects = (value: unknown): DesktopRecentProject[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const projectPath = typeof record.path === 'string' ? record.path.trim() : '';
    if (!projectPath) {
      return [];
    }

    return [{
      path: projectPath,
      label: typeof record.label === 'string' && record.label.trim().length > 0
        ? record.label.trim()
        : undefined,
      openedAt: typeof record.openedAt === 'number' ? record.openedAt : undefined,
    }];
  });
};

const createServerRoutesProvider = (args: { baseUrl: string; root: string }): ProjectFilesystemProvider => {
  const { baseUrl, root } = args;
  let cachedFiles: string[] | null = null;

  const requireOk = async (response: Response): Promise<void> => {
    if (response.ok) return;
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  };

  return {
    listFiles: async () => {
      if (cachedFiles) {
        return [...cachedFiles];
      }
      const response = await fetch(buildApiUrl(baseUrl, '/api/fs/list', { root }));
      await requireOk(response);

      const payload = await response.json() as { files?: unknown };
      const files = Array.isArray(payload.files)
        ? payload.files.filter((value): value is string => typeof value === 'string')
        : [];

      cachedFiles = files.map(normalizePath).sort((a, b) => a.localeCompare(b));
      return [...cachedFiles];
    },
    readFile: async (path: string) => {
      const response = await fetch(buildApiUrl(baseUrl, '/api/fs/read', {
        root,
        path,
      }));
      await requireOk(response);

      const payload = await response.json() as { content?: unknown };
      return typeof payload.content === 'string' ? payload.content : null;
    },
    writeFile: async (path: string, content: string) => {
      const response = await fetch(buildApiUrl(baseUrl, '/api/fs/write'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          root,
          path,
          content,
        }),
      });

      await requireOk(response);
      cachedFiles = null;
    },
  };
};

const createFolderProvider = (root: FsDirectoryHandle): ProjectFilesystemProvider => {
  const cache = new Map<string, FsFileHandle>();
  let cachedFiles: string[] | null = null;

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
      if (cachedFiles) {
        return [...cachedFiles];
      }
      const paths = await walk(root);
      cachedFiles = paths.map(normalizePath).sort((a, b) => a.localeCompare(b));
      return [...cachedFiles];
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
      cachedFiles = null;
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
      '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Filesystem Demo</title><link rel="stylesheet" href="styles.css" /></head><body><main id="app-root"><h1 id="title">Filesystem-backed EditorTs</h1><p id="body">Connect a source and start editing real files.</p></main></body></html>'
    );
  }

  if (!hasCss) {
    await fs.writeFile(
      'styles.css',
      'body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }\n#app-root { max-width: 820px; margin: 0 auto; padding: 2rem 1rem; }\n#title { font-size: 2rem; margin-bottom: 0.5rem; }'
    );
  }
};

export default function App() {
  const nativeBoot = typeof window !== 'undefined' ? window.__EDITORTS_DESKTOP__ : undefined;
  const nativeDesktop = isNativeDesktopRuntime();
  let editor: ReturnType<typeof init> | null = null;
  let canvasPreviewActivated = false;
  let activeProjectConnection: {
    fs: ProjectFilesystemProvider;
    connectedMessage: string;
    sessionNamespaceSuffix: string;
    suggestedAiDirectory?: string;
  } | null = null;
  const permissionQueue: Array<{
    request: ProjectFilesystemPermissionRequest;
    resolve: (reply: ProjectFilesystemPermissionReply) => void;
  }> = [];
  let activePermissionRequest: {
    request: ProjectFilesystemPermissionRequest;
    resolve: (reply: ProjectFilesystemPermissionReply) => void;
  } | null = null;

  const [mode, setMode] = createSignal<FsMode>('browser-folder');
  const [apiBaseUrl, setApiBaseUrl] = createSignal(defaultHttpApiBaseUrl());
  const [projectRoot, setProjectRoot] = createSignal('');
  const [previewBaseUrl, setPreviewBaseUrl] = createSignal('');
  const [aiBaseUrl, setAiBaseUrl] = createSignal(
    loadStoredAiBaseUrl(AI_BASE_URL_STORAGE_KEY, defaultAiBaseUrl()),
  );
  const [aiDirectory, setAiDirectory] = createSignal(loadStoredValue(AI_DIRECTORY_STORAGE_KEY));
  const [statusText, setStatusText] = createSignal(
    'No project connected',
  );
  const [hasProject, setHasProject] = createSignal(false);
  const [recentProjects, setRecentProjects] = createSignal<DesktopRecentProject[]>([]);
  const [pendingPermissionRequest, setPendingPermissionRequest] =
    createSignal<ProjectFilesystemPermissionRequest | null>(null);
  const [advancedUiReady, setAdvancedUiReady] = createSignal(false);
  const [advancedView, setAdvancedView] = createSignal<'editor' | 'code'>('editor');

  const describePermissionRequest = (request: ProjectFilesystemPermissionRequest): string => {
    const targets = request.paths.join(', ');
    return `${request.permission}: ${targets}`;
  };

  const processNextPermissionRequest = (): void => {
    if (activePermissionRequest) return;
    const next = permissionQueue.shift();
    if (!next) {
      setPendingPermissionRequest(null);
      return;
    }

    activePermissionRequest = next;
    setPendingPermissionRequest(next.request);
    setStatusText(`Permission requested: ${describePermissionRequest(next.request)}`);
  };

  const enqueuePermissionRequest = (
    request: ProjectFilesystemPermissionRequest
  ): Promise<ProjectFilesystemPermissionReply> => {
    return new Promise<ProjectFilesystemPermissionReply>((resolve) => {
      permissionQueue.push({ request, resolve });
      processNextPermissionRequest();
    });
  };

  const clearPermissionRequests = (): void => {
    if (activePermissionRequest) {
      activePermissionRequest.resolve('reject');
      activePermissionRequest = null;
    }

    while (permissionQueue.length > 0) {
      const item = permissionQueue.shift();
      item?.resolve('reject');
    }

    setPendingPermissionRequest(null);
  };

  const respondToPermissionRequest = (reply: ProjectFilesystemPermissionReply): void => {
    if (!activePermissionRequest) return;

    const current = activePermissionRequest;
    activePermissionRequest = null;
    setPendingPermissionRequest(null);
    current.resolve(reply);

    setStatusText(`Permission ${reply}: ${describePermissionRequest(current.request)}`);
    processNextPermissionRequest();
  };

  const initializeWithProvider = async (
    fs: ProjectFilesystemProvider,
    connectedMessage: string,
    sessionNamespaceSuffix: string,
    suggestedAiDirectory?: string,
    enableAdvancedUi = advancedUiReady()
  ): Promise<void> => {
    recordRendererPerf('mark', 'initializeWithProvider:start', {
      advancedUi: enableAdvancedUi,
      sessionNamespaceSuffix,
    });
    clearPermissionRequests();
    canvasPreviewActivated = false;
    activeProjectConnection = {
      fs,
      connectedMessage,
      sessionNamespaceSuffix,
      suggestedAiDirectory,
    };

    await measureRendererAsync('ensureSeedFiles', async () => {
      await ensureSeedFiles(fs);
    }, {
      sessionNamespaceSuffix,
    });

    if (editor) {
      recordRendererPerf('mark', 'editor.destroy:start', {
        sessionNamespaceSuffix,
      });
      editor.destroy();
      editor = null;
      recordRendererPerf('measure', 'editor.destroy', {
        sessionNamespaceSuffix,
        ok: true,
      });
    }

    const resolvedAiDirectory = aiDirectory().trim() || suggestedAiDirectory?.trim() || '';
    if (resolvedAiDirectory && resolvedAiDirectory !== aiDirectory().trim()) {
      setAiDirectory(resolvedAiDirectory);
      if (nativeDesktop) {
        void persistNativeDesktopSetting('aiDirectory', resolvedAiDirectory);
      } else {
        persistStoredValue(AI_DIRECTORY_STORAGE_KEY, resolvedAiDirectory);
      }
    }

    const editorConfig: InitConfig = {
      iframeId: 'preview-webview',
      canvas: {
        kind: 'electrobun-webview',
        elementId: 'preview-webview',
        selector: 'electrobun-webview[data-editorts-canvas="preview"]',
        preload: DESKTOP_CANVAS_WEBVIEW_PRELOAD,
      },
      preview: {
        deferInitialLoad: true,
      },
      codeEditor: {
        provider: 'modern-monaco',
        workspace: {
          enabled: true,
          name: 'desktop',
        },
      },
      content: {
        adapter: new ProjectFilesystemAdapter({
          fs,
          loadStrategy: 'auto',
          preview: {
            appBaseUrl: previewBaseUrl().trim() || undefined,
          },
          permissions: {
            defaultAction: 'allow',
            rules: [
              { permission: 'external_directory', pattern: '*', action: 'ask' },
              { permission: 'edit', pattern: '*', action: 'ask' },
            ],
            onRequest: async (request: ProjectFilesystemPermissionRequest): Promise<ProjectFilesystemPermissionReply> => {
              return enqueuePermissionRequest(request);
            },
          },
          save: {
            writeHtml: true,
            writeCss: true,
            writeComponentScripts: true,
            writePageJson: false,
          },
        }),
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
            attributes: { id: `hero-${Date.now()}`, class: 'hero' },
            components: [
              { type: 'text', tagName: 'h1', attributes: { id: `hero-title-${Date.now()}` }, content: 'Hero Title' },
              { type: 'text', tagName: 'p', attributes: { id: `hero-subtitle-${Date.now()}` }, content: 'Filesystem subtitle text' },
            ],
          }),
        }),
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
              .map((page, index) => {
                const label = page.title?.trim() ? page.title.trim() : `Page ${index + 1}`;
                const isActive = index === activePageIndex;
                return `<button type="button" data-page-index="${index}" style="margin-right:0.25rem; padding:0.25rem 0.5rem; ${isActive ? 'background:#4f46e5; color:white;' : ''}">${label}</button>`;
              })
              .join('');

            container.querySelectorAll('[data-page-index]').forEach((button) => {
              button.addEventListener('click', () => {
                const index = Number((button as HTMLElement).dataset.pageIndex);
                if (Number.isFinite(index)) onSelect(index);
              });
            });
          },
        },
        componentPalette: { containerId: 'component-palette', enabled: true },
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
        console.log('Selected:', component.attributes?.id);
      },
    };

    if (enableAdvancedUi) {
      editorConfig.aiProvider = {
        provider: 'opencode',
        mode: 'client',
        baseUrl: aiBaseUrl(),
        directory: () => {
          const nextDirectory = aiDirectory().trim() || suggestedAiDirectory?.trim() || '';
          return nextDirectory || '';
        },
        stream: { enabled: true },
        prompt: {
          injectWorkspaceSnapshot: false,
        },
        sessions: {
          storageNamespace: `filesystem-solid:${sessionNamespaceSuffix}`,
          hydrateRemoteList: false,
          ...(nativeDesktop
            ? {
              storage: {
                load: loadNativeDesktopStoragePage,
                save: saveNativeDesktopStoragePage,
                delete: deleteNativeDesktopStoragePage,
              },
            }
            : {}),
        },
      };
      editorConfig.ui = {
        ...editorConfig.ui,
        editors: {
          files: { containerId: 'files-viewer-container', enabled: true },
          viewer: { containerId: 'viewer-editor-container', enabled: true },
        },
        viewTabs: {
          editorButtonId: 'tab-editor',
          codeButtonId: 'tab-code',
          defaultView: advancedView(),
        },
        aiChat: {
          rootId: SHARED_AI_UI_IDS.chatRoot,
          inputId: SHARED_AI_UI_IDS.chatInput,
          sendButtonId: SHARED_AI_UI_IDS.chatSendButton,
          applyButtonId: SHARED_AI_UI_IDS.chatApplyButton,
          logId: SHARED_AI_UI_IDS.chatLog,
          statusId: SHARED_AI_UI_IDS.chatStatus,
          sessionListId: SHARED_AI_UI_IDS.sessionList,
          modelSelectId: SHARED_AI_UI_IDS.modelSelect,
          sessionNewButtonId: SHARED_AI_UI_IDS.sessionNewButton,
          sessionResetButtonId: SHARED_AI_UI_IDS.sessionResetButton,
          healthButtonId: SHARED_AI_UI_IDS.healthButton,
          healthStatusId: SHARED_AI_UI_IDS.healthStatus,
          baseUrlInputId: SHARED_AI_UI_IDS.baseUrlInput,
          autoApply: false,
          stream: { enabled: true },
          link: {
            anchorId: SHARED_AI_UI_IDS.link,
            path: '/chats',
            enabled: true,
          },
          enabled: true,
        },
      };
    }

    editor = await measureRendererAsync('editor.init', async () => {
      return init(editorConfig);
    }, {
      advancedUi: enableAdvancedUi,
      sessionNamespaceSuffix,
    });
    if (editorConfig.aiProvider?.provider === 'opencode' && editorConfig.aiProvider.prompt?.injectWorkspaceSnapshot === false) {
      setAiDiffEmptyState(
        'Raw OpenCode chat is active. Use OpenCode clients and session tools for transcript-first workflows.',
        'No diff preview',
      );
    } else {
      installAiDiffPreview(editor);
      setAiDiffEmptyState(
        'Generate a reply with file replacements to inspect it here before applying.',
        'Awaiting AI changes',
      );
    }
    await measureRendererAsync('editor.content.load', async () => {
      await editor?.content.load();
    }, {
      sessionNamespaceSuffix,
    });
    const preview = await measureRendererAsync('editor.preview.describe', async () => {
      return editor?.preview.describe();
    }, {
      sessionNamespaceSuffix,
    });
    setHasProject(true);
    const aiDirectoryMessage = resolvedAiDirectory
      ? ' OpenCode is scoped to the selected project path.'
      : mode() === 'browser-folder'
        ? ' AI workspace path is not set yet; OpenCode will use its server cwd until you fill in AI Working Directory.'
        : '';
    if (preview?.mode === 'app-url' && preview.baseUrl) {
      const routeCount = preview.routes.length;
      setStatusText(`Connected. Live app preview ready${routeCount > 0 ? ` (${routeCount} route${routeCount === 1 ? '' : 's'} discovered)` : ''}.${aiDirectoryMessage}`);
    } else if (preview?.runtime === 'app') {
      setStatusText(`Connected. App workspace detected. Add an App Preview URL to boot the real app in the canvas.${aiDirectoryMessage}`);
    } else {
      setStatusText(`Connected.${aiDirectoryMessage}`);
    }

    (window as unknown as { editor?: ReturnType<typeof init> }).editor = editor;
    recordRendererPerf('measure', 'initializeWithProvider', {
      advancedUi: enableAdvancedUi,
      sessionNamespaceSuffix,
      ok: true,
    });
  };

  const connectProjectRoot = async (args: {
    root: string;
    provider?: ProjectFilesystemProvider;
    baseUrl?: string;
    connectedMessage: string;
    sessionNamespaceSuffix?: string;
    suggestedAiDirectory?: string;
    recentProjectLabel?: string;
    nextMode?: FsMode;
    persistLastProject?: boolean;
    persistRecentProject?: boolean;
  }): Promise<void> => {
    const root = args.root.trim();
    if (!root) {
      setStatusText('Project root path is empty.');
      return;
    }

    if (args.nextMode) {
      setMode(args.nextMode);
    }
    setProjectRoot(root);

    const fs = args.provider ?? (() => {
      const baseUrl = args.baseUrl?.trim() ?? '';
      if (!baseUrl) {
        throw new Error('Filesystem API base URL is empty.');
      }

      return createServerRoutesProvider({
        baseUrl,
        root,
      });
    })();
    const sessionNamespace =
      args.sessionNamespaceSuffix ?? (sanitizeSessionNamespaceSegment(root) || 'project-root');
    await measureRendererAsync('connectProjectRoot', async () => {
      await initializeWithProvider(fs, args.connectedMessage, sessionNamespace, args.suggestedAiDirectory ?? root);
    }, {
      mode: args.nextMode ?? mode(),
      root,
      sessionNamespace,
    });

    if (nativeDesktop && args.persistLastProject) {
      void persistNativeDesktopSetting('lastProjectRoot', root);
    }

    if (nativeDesktop && args.persistRecentProject) {
      void persistNativeRecentProject(root, args.recentProjectLabel);
    }
  };

  const enableAdvancedWorkspaceUi = async (target: 'chat' | 'code'): Promise<void> => {
    if (advancedUiReady()) return;
    setAdvancedView(target === 'code' ? 'code' : 'editor');
    setAdvancedUiReady(true);

    if (!activeProjectConnection) {
      setStatusText(target === 'chat'
        ? 'AI workspace will finish loading after you connect a project.'
        : 'Code workspace will finish loading after you connect a project.');
      return;
    }

    setStatusText(target === 'chat'
      ? 'Loading AI workspace for this project...'
      : 'Loading code workspace for this project...');

    const connection = activeProjectConnection;
    await measureRendererAsync('enableAdvancedWorkspaceUi', async () => {
      await initializeWithProvider(
        connection.fs,
        connection.connectedMessage,
        connection.sessionNamespaceSuffix,
        connection.suggestedAiDirectory,
        true,
      );
    }, {
      target,
    });
  };

  const activateCanvasPreview = async (): Promise<void> => {
    if (!editor || canvasPreviewActivated === true) {
      return;
    }

    canvasPreviewActivated = true;
    setStatusText('Loading canvas preview...');

    try {
      await measureRendererAsync('activateCanvasPreview', async () => {
        await editor?.preview.refresh();
      });
      setStatusText('Canvas preview ready.');
    } catch (error: unknown) {
      canvasPreviewActivated = false;
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Canvas preview failed to load: ${message}`);
    }
  };

  const hydrateNativeDesktopState = async (options?: { restoreProject?: boolean }): Promise<void> => {
    if (!nativeDesktop) return;

    const payload = await measureRendererAsync('hydrateNativeDesktopState.fetch', async () => {
      return fetchNativeDesktopState();
    });
    const settings = parseDesktopNativeSettings(payload?.settings);
    const nextRecentProjects = parseDesktopRecentProjects(payload?.recentProjects);
    setRecentProjects(nextRecentProjects);

    if (typeof settings.lastProjectRoot === 'string' && settings.lastProjectRoot.trim().length > 0) {
      setProjectRoot(settings.lastProjectRoot.trim());
    }

    if (typeof settings.previewBaseUrl === 'string' && settings.previewBaseUrl.trim().length > 0) {
      setPreviewBaseUrl(settings.previewBaseUrl.trim());
    }

    if (typeof settings.aiBaseUrl === 'string' && settings.aiBaseUrl.trim().length > 0) {
      setAiBaseUrl(settings.aiBaseUrl.trim());
    }

    if (typeof settings.aiDirectory === 'string' && settings.aiDirectory.trim().length > 0) {
      setAiDirectory(settings.aiDirectory.trim());
    }

    if (!hasProject()) {
      setStatusText('No project connected');
    }

    const restoreProject = options?.restoreProject ?? false;
    const lastProjectRoot = typeof settings.lastProjectRoot === 'string'
      ? settings.lastProjectRoot.trim()
      : '';
    if (!restoreProject || !lastProjectRoot) {
      return;
    }

    await connectProjectRoot({
      root: lastProjectRoot,
      provider: createNativeProjectProvider(lastProjectRoot),
      connectedMessage: `Native project restored: ${lastProjectRoot}`,
      nextMode: 'browser-folder',
      persistLastProject: false,
      persistRecentProject: false,
      suggestedAiDirectory: typeof settings.aiDirectory === 'string' && settings.aiDirectory.trim().length > 0
        ? settings.aiDirectory.trim()
        : lastProjectRoot,
    });
  };

  const connectInitialProjectRoot = async (initialRoot: string): Promise<void> => {
    const root = initialRoot.trim();
    if (!root) {
      return;
    }

    await measureRendererAsync('connectInitialProjectRoot', async () => {
      await connectProjectRoot({
        root,
        provider: createNativeProjectProvider(root),
        connectedMessage: `Native project connected from CLI: ${root}`,
        nextMode: 'browser-folder',
        persistLastProject: true,
        persistRecentProject: true,
      });
    }, {
      root,
    });
    await hydrateNativeDesktopState();
  };

  onMount(() => {
    recordRendererPerf('lifecycle', 'app-mounted', {
      nativeDesktop,
    });
    if (!nativeDesktop) return;

    void (async () => {
      try {
        const initialProjectRoot = nativeBoot?.initialProjectRoot?.trim() ?? '';
        await hydrateNativeDesktopState({ restoreProject: initialProjectRoot.length === 0 });
        if (initialProjectRoot.length > 0) {
          await connectInitialProjectRoot(initialProjectRoot);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusText(`Desktop state failed to load: ${message}`);
      }
    })();
  });

  const onPickProject = async () => {
    if (!nativeDesktop && !supportsDirectoryPicker()) {
      setStatusText('This browser does not support showDirectoryPicker().');
      return;
    }

    try {
      setStatusText(nativeDesktop ? 'Opening native project picker...' : 'Opening project folder picker...');

      if (nativeDesktop) {
        const selectedProject = await openNativeProjectDirectory(projectRoot().trim() || undefined);
        const selectedRoot = selectedProject?.path?.trim() ?? '';
        if (!selectedRoot) {
          setStatusText('Project selection cancelled.');
          return;
        }

        await connectProjectRoot({
          root: selectedRoot,
          provider: createNativeProjectProvider(selectedRoot),
          connectedMessage: `Native project connected: ${selectedRoot}`,
          recentProjectLabel: selectedProject?.label,
          nextMode: 'browser-folder',
          persistLastProject: true,
          persistRecentProject: false,
        });
        await hydrateNativeDesktopState();
        return;
      }

      const host = getDirectoryPickerHost();
      const picker = host.showDirectoryPicker;
      if (!picker) {
        setStatusText('Directory picker is unavailable.');
        return;
      }

      const root = await picker();
      const fs = createFolderProvider(root);
      const folderName = typeof root.name === 'string' && root.name.trim().length > 0
        ? root.name.trim()
        : 'browser-folder';
      const sessionNamespace = sanitizeSessionNamespaceSegment(folderName) || 'browser-folder';
      await measureRendererAsync('connectBrowserFolder', async () => {
        await initializeWithProvider(fs, 'Browser folder connected. Files tab is live.', sessionNamespace);
      }, {
        sessionNamespace,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('abort')) {
        setStatusText('Folder selection cancelled.');
      } else {
        setStatusText(`Failed to open folder: ${message}`);
      }
    }
  };

  const onConnectServerRoutes = async () => {
    const root = projectRoot().trim();
    if (!root) {
      setStatusText('Enter a project root path for server-routes mode.');
      return;
    }

    try {
      setStatusText('Connecting to server routes...');
      await connectProjectRoot({
        root,
        baseUrl: apiBaseUrl(),
        connectedMessage: `Server routes connected: ${root}`,
        sessionNamespaceSuffix: sanitizeSessionNamespaceSegment(root) || 'server-routes',
        nextMode: 'server-routes',
        persistLastProject: nativeDesktop,
        persistRecentProject: nativeDesktop,
      });
      if (nativeDesktop) {
        await hydrateNativeDesktopState();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusText(`Server routes connection failed: ${message}`);
    }
  };

  const onReloadProject = async () => {
    if (!editor) return;

    try {
      setStatusText('Reloading project files...');
      await measureRendererAsync('reloadProject', async () => {
        await editor?.content.load();
        editor?.refresh();
        await editor?.preview.refresh();
      });
      setStatusText('Project reloaded.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusText(`Reload failed: ${message}`);
    }
  };

  const handleAiBaseUrlChange = (value: string): void => {
    setAiBaseUrl(value);
    if (nativeDesktop) {
      void persistNativeDesktopSetting('aiBaseUrl', value);
      return;
    }
    persistAiBaseUrl(AI_BASE_URL_STORAGE_KEY, value);
  };

  const handleAiDirectoryChange = (value: string): void => {
    setAiDirectory(value);
    if (nativeDesktop) {
      void persistNativeDesktopSetting('aiDirectory', value);
    } else {
      persistStoredValue(AI_DIRECTORY_STORAGE_KEY, value);
    }
    if (advancedUiReady()) {
      setStatusText('AI working directory updated. The next AI request will use the new project path.');
    }
  };

  onCleanup(() => {
    clearPermissionRequests();
    editor?.destroy();
  });

  return (
    <AppShell
      fsSupported={nativeDesktop || supportsDirectoryPicker()}
      nativeRuntime={nativeDesktop}
      advancedUiReady={advancedUiReady()}
      hasProject={hasProject()}
      mode={mode()}
      apiBaseUrl={apiBaseUrl()}
      projectRoot={projectRoot()}
      previewBaseUrl={previewBaseUrl()}
      aiBaseUrl={aiBaseUrl()}
      aiDirectory={aiDirectory()}
      recentProjects={recentProjects()}
      statusText={statusText()}
      permissionRequest={pendingPermissionRequest()}
      onModeChange={(nextMode) => {
        setMode(nextMode);
        if (nextMode === 'browser-folder') {
          setStatusText('Folder mode selected.');
          return;
        }

        setStatusText('Server-routes mode selected. Configure API base URL and root path.');
      }}
      onApiBaseUrlChange={(value) => {
        setApiBaseUrl(value);
      }}
      onProjectRootChange={(value) => {
        setProjectRoot(value);
      }}
      onPreviewBaseUrlChange={(value) => {
        setPreviewBaseUrl(value);
        if (nativeDesktop) {
          void persistNativeDesktopSetting('previewBaseUrl', value);
        }
      }}
      onAiBaseUrlChange={handleAiBaseUrlChange}
      onAiDirectoryChange={handleAiDirectoryChange}
      onMainTabActivate={(tab) => {
        if (tab === 'editor') {
          void activateCanvasPreview();
          return;
        }

        if (tab === 'chat' || tab === 'code') {
          void enableAdvancedWorkspaceUi(tab);
        }
      }}
      onPickProject={() => {
        void onPickProject();
      }}
      onConnectServerRoutes={() => {
        void onConnectServerRoutes();
      }}
      onReloadProject={() => {
        void onReloadProject();
      }}
      onOpenRecentProject={(projectPath) => {
        void (async () => {
          try {
            await connectProjectRoot({
              root: projectPath,
              provider: createNativeProjectProvider(projectPath),
              connectedMessage: `Native project connected: ${projectPath}`,
              nextMode: 'browser-folder',
              persistLastProject: true,
              persistRecentProject: true,
            });
            await hydrateNativeDesktopState();
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setStatusText(`Failed to open recent project: ${message}`);
          }
        })();
      }}
      onPermissionReply={(reply) => {
        respondToPermissionRequest(reply);
      }}
    />
  );
}
