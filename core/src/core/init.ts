/**
 * EditorTs Editor Initialization
 * Users control the layout - init() just populates their containers
 */

import { Page } from './Page';
import { LayerManager } from './LayerManager';
import { ComponentPalette } from './ComponentPalette';
import { JsonContentAdapter } from './JsonContentAdapter';
import { StorageManager } from './StorageManager';
import { VersionControl } from './VersionControl';
import { KeyboardShortcuts, createCommandPaletteShortcuts, createDefaultShortcuts, createEditorShortcuts, type ShortcutContext } from './KeyboardShortcuts';
import { defaultComponentRegistry, mergeCustomComponentRegistry } from './CustomComponentRegistry';
import { buildIframeCanvasSrcdocFromPage } from './iframeCanvas';
import {
  applyAiReplacementsToFiles,
  extractAiChatRequestText,
  extractAiReplacementPaths,
  requestAiReplacements,
  summarizeAiAssistantText,
} from './aiChat';
import { encodeAiModelSelectValue, formatAiModelOptionLabel, normalizeOpencodeModelId, parseAiModelRef, readProviderDefaultModels } from './aiModels';
import type {
  InitConfig,
  EditorTsEditor,
  Component,
  PageData,
  MultiPageData,
  EditorTsAiModule,
  OpencodeAiProviderConfig,
  AiProviderMode,
  EditorTsEventMap,
  EditorTsEventName,
  PagesRenderProps,
  PagePayload,
  ContentAdapter,
  ContentAdapterPreviewDescriptor,
  ContentPreviewRoute,
  OpencodeServer,
} from '../types';

type OpencodeClientSdkModule = {
  createOpencodeClient(args: {
    baseUrl: string;
    fetch?: (request: Request) => Promise<Response>;
  }): PromiseLike<import('@opencode-ai/sdk/client').OpencodeClient> | import('@opencode-ai/sdk/client').OpencodeClient;
};

type OpencodeServerSdkModule = {
  createOpencode(args: {
    hostname?: string;
    port?: number;
    signal?: AbortSignal;
    timeout?: number;
    config?: Record<string, unknown>;
  }): Promise<{
    client: import('@opencode-ai/sdk/client').OpencodeClient;
    server: OpencodeServer;
  }>;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const normalizePreviewPath = (path: string | null | undefined): string | null => {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const resolvePreviewUrl = (baseUrl: string, routePath: string | null): string => {
  const normalizedRoute = normalizePreviewPath(routePath) ?? '/';
  const resolvedBase = new URL(baseUrl, window.location.origin);
  const basePath = trimTrailingSlash(resolvedBase.pathname);

  resolvedBase.pathname = `${basePath === '/' ? '' : basePath}${normalizedRoute === '/' ? '' : normalizedRoute}` || '/';
  resolvedBase.search = '';
  resolvedBase.hash = '';
  return resolvedBase.toString();
};

/**
 * Initialize EditorTs Editor
 * User creates the HTML structure, init() populates it
 */
export function init(config: InitConfig): EditorTsEditor {
  // Get the iframe element (required)
  const iframe = document.getElementById(config.iframeId) as HTMLIFrameElement;
  if (!iframe || iframe.tagName !== 'IFRAME') {
    throw new Error(`Iframe element #${config.iframeId} not found or is not an iframe`);
  }
  const vimMode = config.vimMode ?? false;

  if (typeof config.data === 'undefined' && !config.content?.adapter) {
    throw new Error('EditorTs init requires `data` when `content.adapter` is not provided.');
  }

  const isMultiPageData = (data: PageData | MultiPageData): data is MultiPageData => {
    return !!data && typeof data === 'object' && Array.isArray((data as MultiPageData).pages);
  };

  const parsePayload = (payload: PagePayload): PageData | MultiPageData => {
    if (typeof payload === 'string') {
      return JSON.parse(payload) as PageData | MultiPageData;
    }
    return payload;
  };

  const initialPayload = config.data ?? JsonContentAdapter.createDefaultPageData();
  const contentAdapter: ContentAdapter = config.content?.adapter ?? new JsonContentAdapter(initialPayload);
  const shouldHydrateFromContentAdapter = !!config.content?.adapter;

  const rawData: PageData | MultiPageData =
    parsePayload(initialPayload);
  let multiPageData: MultiPageData | null = null;
  let activePageIndex = 0;

  let initialPageData: PageData;
  if (isMultiPageData(rawData)) {
    if (rawData.pages.length === 0) {
      throw new Error('MultiPageData.pages cannot be empty');
    }

    multiPageData = rawData;
    activePageIndex = rawData.activePageIndex ?? 0;
    initialPageData = rawData.pages[activePageIndex] ?? rawData.pages[0]!;
  } else {
    initialPageData = rawData as PageData;
  }

  const componentRegistry = mergeCustomComponentRegistry(defaultComponentRegistry, config.customComponents);

  const resolveComponents = (components: Component[]): Component[] => {
    const resolveComponent = (component: Component): Component => {
      const def = componentRegistry[component.type];

      const isStub =
        component.tagName === undefined &&
        component.components === undefined &&
        component.content === undefined &&
        component.script === undefined &&
        component.style === undefined;

      const base = def && isStub ? def.factory() : component;

      const mergedAttributes = {
        ...(base.attributes ?? {}),
        ...(component.attributes ?? {}),
      };

      const next: Component = {
        ...base,
        ...component,
        attributes: mergedAttributes,
      };

      if (next.components && next.components.length > 0) {
        next.components = next.components.map(resolveComponent);
      }

      return next;
    };

    return components.map(resolveComponent);
  };

  const resolvePageData = (data: PageData): PageData => {
    const raw = data.body.components;

    if (Array.isArray(raw)) {
      data.body.components = resolveComponents(raw);
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as Component[];
        data.body.components = JSON.stringify(resolveComponents(parsed));
      } catch {
        // ignore
      }
    }

    return data;
  };

  const resolvedInitialPageData = resolvePageData(initialPageData);
  if (multiPageData) {
    multiPageData.pages[activePageIndex] = resolvedInitialPageData;
  }

  // Create Page instance
  const page = new Page(resolvedInitialPageData);

  // Configure toolbars from config
  if (config.toolbars) {
    if (config.toolbars.byId) {
      Object.entries(config.toolbars.byId).forEach(([id, toolbarConfig]) => {
        page.toolbars.configureById(id, toolbarConfig);
      });
    }

    if (config.toolbars.byType) {
      Object.entries(config.toolbars.byType).forEach(([type, toolbarConfig]) => {
        page.toolbars.configureByType(type, toolbarConfig);
      });
    }

    if (config.toolbars.byTag) {
      Object.entries(config.toolbars.byTag).forEach(([tag, toolbarConfig]) => {
        page.toolbars.configureByTag(tag, toolbarConfig);
      });
    }

    if (config.toolbars.default) {
      page.toolbars.setGlobalDefault(config.toolbars.default);
    }
  }

  const applyParsedPayload = (parsed: PageData | MultiPageData) => {
    const toolbarRuntimeConfig = page.toolbars.exportConfig();

    if (isMultiPageData(parsed)) {
      if (!parsed.pages || parsed.pages.length === 0) {
        throw new Error('MultiPageData.pages cannot be empty');
      }

      multiPageData = parsed;
      activePageIndex = parsed.activePageIndex ?? 0;

      const loadedPageData = resolvePageData(parsed.pages[activePageIndex] ?? parsed.pages[0]!);
      const newPage = new Page(loadedPageData);
      Object.assign(page, newPage);
    } else {
      multiPageData = null;
      activePageIndex = 0;

      const newPage = new Page(resolvePageData(parsed as PageData));
      Object.assign(page, newPage);
    }

    page.toolbars.importConfig(toolbarRuntimeConfig);
  };

  const applyPayload = (payload: PagePayload) => {
    applyParsedPayload(parsePayload(payload));
  };

  // Event system
  type AnyEditorEventArgs = EditorTsEventMap[EditorTsEventName];
  type AnyEditorEventCallback = (...args: AnyEditorEventArgs) => void;

  const eventListeners: Partial<Record<EditorTsEventName, AnyEditorEventCallback[]>> = {};

  const on = <K extends EditorTsEventName>(event: K, callback: (...args: EditorTsEventMap[K]) => void) => {
    if (!eventListeners[event]) {
      eventListeners[event] = [];
    }
    eventListeners[event]!.push(callback as AnyEditorEventCallback);
  };

  const off = <K extends EditorTsEventName>(event: K, callback: (...args: EditorTsEventMap[K]) => void) => {
    if (eventListeners[event]) {
      eventListeners[event] = eventListeners[event]!.filter((cb) => cb !== (callback as AnyEditorEventCallback));
    }
  };

  const emit = <K extends EditorTsEventName>(event: K, ...args: EditorTsEventMap[K]) => {
    eventListeners[event]?.forEach((callback) => callback(...(args as AnyEditorEventArgs)));
  };

  const lifecycleAbortController = new AbortController();
  const lifecycleSignal = lifecycleAbortController.signal;

  const addManagedEventListener = (
    target: EventTarget | null | undefined,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    if (!target) return;

    if (typeof options === 'boolean') {
      target.addEventListener(type, listener, { capture: options, signal: lifecycleSignal });
      return;
    }

    target.addEventListener(type, listener, { ...(options ?? {}), signal: lifecycleSignal });
  };

  // Get optional UI containers
  const sidebarContainer = config.ui?.sidebar?.containerId
    ? document.getElementById(config.ui.sidebar.containerId)
    : null;

  // Optional AI UI (user-provided elements)
  const aiChatConfig = config.ui?.aiChat;
  const shouldEnableAiChatUi = !!aiChatConfig && aiChatConfig.enabled !== false;

  const aiChatRoot = shouldEnableAiChatUi
    ? (aiChatConfig?.rootId ? document.getElementById(aiChatConfig.rootId) : null)
    : null;

  const aiChatExpandButton = shouldEnableAiChatUi && aiChatConfig?.expandButtonId
    ? document.getElementById(aiChatConfig.expandButtonId)
    : null;

  const aiBaseUrlInput = shouldEnableAiChatUi && aiChatConfig?.baseUrlInputId
    ? (document.getElementById(aiChatConfig.baseUrlInputId) as HTMLInputElement | null)
    : null;

  const aiChatInput = shouldEnableAiChatUi && aiChatConfig?.inputId
    ? (document.getElementById(aiChatConfig.inputId) as HTMLTextAreaElement | null)
    : null;

  const aiChatSendButton = shouldEnableAiChatUi && aiChatConfig?.sendButtonId
    ? (document.getElementById(aiChatConfig.sendButtonId) as HTMLButtonElement | null)
    : null;

  const aiChatApplyButton = shouldEnableAiChatUi && aiChatConfig?.applyButtonId
    ? (document.getElementById(aiChatConfig.applyButtonId) as HTMLButtonElement | null)
    : null;

  const aiChatLog = shouldEnableAiChatUi && aiChatConfig?.logId
    ? (document.getElementById(aiChatConfig.logId) as HTMLElement | null)
    : null;
  const aiChatStatus = shouldEnableAiChatUi && aiChatConfig?.statusId
    ? (document.getElementById(aiChatConfig.statusId) as HTMLElement | null)
    : null;

  const aiChatLinkAnchor = shouldEnableAiChatUi && aiChatConfig?.link?.enabled !== false && aiChatConfig?.link?.anchorId
    ? (document.getElementById(aiChatConfig.link.anchorId) as HTMLAnchorElement | null)
    : null;

  const aiSessionSelect = shouldEnableAiChatUi && aiChatConfig?.sessionSelectId
    ? (document.getElementById(aiChatConfig.sessionSelectId) as HTMLSelectElement | null)
    : null;
  const aiSessionList = shouldEnableAiChatUi && aiChatConfig?.sessionListId
    ? (document.getElementById(aiChatConfig.sessionListId) as HTMLElement | null)
    : null;
  const aiModelSelect = shouldEnableAiChatUi && aiChatConfig?.modelSelectId
    ? (document.getElementById(aiChatConfig.modelSelectId) as HTMLSelectElement | null)
    : null;
  const aiSessionNewButton = shouldEnableAiChatUi && aiChatConfig?.sessionNewButtonId
    ? (document.getElementById(aiChatConfig.sessionNewButtonId) as HTMLButtonElement | null)
    : null;
  const aiSessionResetButton = shouldEnableAiChatUi && aiChatConfig?.sessionResetButtonId
    ? (document.getElementById(aiChatConfig.sessionResetButtonId) as HTMLButtonElement | null)
    : null;


  const aiHealthButton = shouldEnableAiChatUi && aiChatConfig?.healthButtonId
    ? (document.getElementById(aiChatConfig.healthButtonId) as HTMLButtonElement | null)
    : null;

  const aiHealthStatus = shouldEnableAiChatUi && aiChatConfig?.healthStatusId
    ? (document.getElementById(aiChatConfig.healthStatusId) as HTMLElement | null)
    : null;

  // If the host app serves the editor and can proxy requests, prefer that to avoid
  // CORS preflight issues with password-protected opencode servers.
  const aiProxiedBaseUrl = `${window.location.origin}/opencode`;

  const statsContainer = config.ui?.stats?.containerId
    ? document.getElementById(config.ui.stats.containerId)
    : null;

  const selectedInfoContainer = config.ui?.selectedInfo?.containerId
    ? document.getElementById(config.ui.selectedInfo.containerId)
    : null;

  const layersContainer = config.ui?.layers?.containerId
    ? document.getElementById(config.ui.layers.containerId)
    : null;

  const pagesContainer = config.ui?.pages?.containerId
    ? document.getElementById(config.ui.pages.containerId)
    : null;

  const shouldEnablePages = !!pagesContainer && config.ui?.pages?.enabled !== false;

  const componentPaletteContainer = config.ui?.componentPalette?.containerId
    ? document.getElementById(config.ui.componentPalette.containerId)
    : null;

  const autoSaveProgressBar = config.ui?.autoSave?.progressBarId
    ? (document.getElementById(config.ui.autoSave.progressBarId) as HTMLElement | null)
    : null;

  const commandPaletteContainer = config.ui?.commandPalette?.containerId
    ? (document.getElementById(config.ui.commandPalette.containerId) as HTMLElement | null)
    : null;
  const commandPaletteInput = config.ui?.commandPalette?.inputId
    ? (document.getElementById(config.ui.commandPalette.inputId) as HTMLInputElement | null)
    : null;
  const commandPaletteResults = config.ui?.commandPalette?.resultsId
    ? (document.getElementById(config.ui.commandPalette.resultsId) as HTMLElement | null)
    : null;
  const commandPaletteClose = config.ui?.commandPalette?.closeButtonId
    ? (document.getElementById(config.ui.commandPalette.closeButtonId) as HTMLButtonElement | null)
    : null;
  const commandPaletteHint = config.ui?.commandPalette?.hintId
    ? (document.getElementById(config.ui.commandPalette.hintId) as HTMLElement | null)
    : null;

  // Optional code editor containers
  const jsEditorContainer = config.ui?.editors?.js?.containerId
    ? document.getElementById(config.ui.editors.js.containerId)
    : null;
  const cssEditorContainer = config.ui?.editors?.css?.containerId
    ? document.getElementById(config.ui.editors.css.containerId)
    : null;
  const jsonEditorContainer = config.ui?.editors?.json?.containerId
    ? document.getElementById(config.ui.editors.json.containerId)
    : null;
  const jsxEditorContainer = config.ui?.editors?.jsx?.containerId
    ? document.getElementById(config.ui.editors.jsx.containerId)
    : null;
  const filesViewerContainer = config.ui?.editors?.files?.containerId
    ? document.getElementById(config.ui.editors.files.containerId)
    : null;
  const viewerEditorContainer = config.ui?.editors?.viewer?.containerId
    ? document.getElementById(config.ui.editors.viewer.containerId)
    : null;


  // Optional: tabbed view toggle between canvas + code panels
  // This does not create UI; it only wires existing buttons.
  type CodeTab = 'files' | 'viewer' | 'js' | 'css' | 'json' | 'jsx';

  let setView: ((view: 'editor' | 'code') => void) | null = null;
  let setCodeTab: ((tab: CodeTab) => void) | null = null;

  // Avoid TDZ by deferring workspace-dependent hooks until after the
  // workspace variables are initialized later in init().
  let codeTabHooksReady = false;

  const onCodeTabChange = (tab: CodeTab) => {
    if (!codeTabHooksReady) return;
    if (tab !== 'files') return;

    void (async () => {
      if (workspaceEnabled && !workspace) {
        try {
          const mod = await import('modern-monaco');
          await ensureWorkspace(mod);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('Failed to load modern-monaco workspace:', message);
        }
      }

      await syncWorkspaceFiles();
      await renderFilesList();
    })();
  };

  const viewTabs = config.ui?.viewTabs;
  if (viewTabs) {
    const codeViewContainers = [filesViewerContainer, viewerEditorContainer, jsEditorContainer, cssEditorContainer, jsonEditorContainer, jsxEditorContainer]
      .filter(Boolean) as HTMLElement[];

    const codeTabs = config.ui?.codeTabs;

    const codeTabButtons: Record<CodeTab, HTMLElement | null> = {
      files: codeTabs?.filesButtonId ? document.getElementById(codeTabs.filesButtonId) : null,
      viewer: codeTabs?.viewerButtonId ? document.getElementById(codeTabs.viewerButtonId) : null,
      js: codeTabs?.jsButtonId ? document.getElementById(codeTabs.jsButtonId) : null,
      css: codeTabs?.cssButtonId ? document.getElementById(codeTabs.cssButtonId) : null,
      json: codeTabs?.jsonButtonId ? document.getElementById(codeTabs.jsonButtonId) : null,
      jsx: codeTabs?.jsxButtonId ? document.getElementById(codeTabs.jsxButtonId) : null,
    };

    setCodeTab = (tab: CodeTab) => {
      document.documentElement.dataset.editortsCodeTab = tab;

      const containers: Record<CodeTab, HTMLElement | null> = {
        files: filesViewerContainer,
        viewer: viewerEditorContainer,
        js: jsEditorContainer,
        css: cssEditorContainer,
        json: jsonEditorContainer,
        jsx: jsxEditorContainer,
      };

      (Object.keys(containers) as CodeTab[]).forEach((key) => {
        const el = containers[key];
        if (!el) return;
        el.style.display = key === tab ? '' : 'none';
      });

      (Object.keys(codeTabButtons) as CodeTab[]).forEach((key) => {
        const btn = codeTabButtons[key];
        if (!btn) return;
        btn.classList.toggle('active', key === tab);
        btn.setAttribute('aria-pressed', String(key === tab));
      });

      onCodeTabChange?.(tab);

    };

    const originalDisplayByEl = new Map<HTMLElement, string>();
    codeViewContainers.forEach((el) => originalDisplayByEl.set(el, el.style.display));
    const originalIframeDisplay = iframe.style.display;

    const editorButton = viewTabs.editorButtonId
      ? (document.getElementById(viewTabs.editorButtonId) as HTMLButtonElement | null)
      : null;

    const codeButton = viewTabs.codeButtonId
      ? (document.getElementById(viewTabs.codeButtonId) as HTMLButtonElement | null)
      : null;

    setView = (view: 'editor' | 'code') => {
      document.documentElement.dataset.editortsView = view;
      document.documentElement.setAttribute('data-editorts-view', view);

      editorButton?.classList.toggle('active', view === 'editor');
      editorButton?.setAttribute('aria-pressed', String(view === 'editor'));
      codeButton?.classList.toggle('active', view === 'code');
      codeButton?.setAttribute('aria-pressed', String(view === 'code'));

      if (view === 'code') {
        iframe.style.display = 'none';

        // Show the code containers, then if code tabs are enabled,
        // immediately apply the active tab to hide the others.
        codeViewContainers.forEach((el) => {
          const original = originalDisplayByEl.get(el);
          el.style.display = original ?? '';
        });

        if (codeTabs) {
          const active = (document.documentElement.dataset.editortsCodeTab as CodeTab | undefined) ?? (codeTabs.defaultTab ?? 'js');
          setCodeTab?.(active as CodeTab);
        }
      } else {
        iframe.style.display = originalIframeDisplay ?? '';
        codeViewContainers.forEach((el) => {
          el.style.display = 'none';
        });
      }
    };

    if (viewTabs.editorButtonId) {
      if (editorButton) {
        addManagedEventListener(editorButton, 'click', () => setView?.('editor'));
      } else {
        console.warn(`EditorTs: editorButtonId element #${viewTabs.editorButtonId} not found`);
      }
    }

    if (viewTabs.codeButtonId) {
      if (codeButton) {
        addManagedEventListener(codeButton, 'click', () => setView?.('code'));
      } else {
        console.warn(`EditorTs: codeButtonId element #${viewTabs.codeButtonId} not found`);
      }
    }

    // Default to the canvas unless configured otherwise.
    setView(viewTabs.defaultView ?? 'editor');

    // Ensure the attribute exists even when viewTabs wiring is disabled.
    document.documentElement.setAttribute('data-editorts-view', viewTabs.defaultView ?? 'editor');

    if (codeTabs) {
      (Object.entries(codeTabButtons) as Array<[keyof typeof codeTabButtons, HTMLElement | null]>).forEach(([tab, btn]) => {
        addManagedEventListener(btn, 'click', () => setCodeTab?.(tab));
      });

      setCodeTab?.(codeTabs.defaultTab ?? 'js');
    }
  }

  // Initialize component palette if container provided
  let componentPalette: ComponentPalette | null = null;
  let pendingInsertType: string | null = null;

  if (componentPaletteContainer && config.ui?.componentPalette?.enabled !== false) {
    componentPalette = new ComponentPalette({
      container: componentPaletteContainer,
      registry: componentRegistry,
      onPick: (type) => {
        pendingInsertType = type;
        componentPalette?.setSelected(type);

        iframe.contentWindow?.postMessage(
          {
            type: 'editorts:placementMode',
            enabled: true,
          },
          '*'
        );
      },
    });
  }

  // Initialize layer manager if container provided
  let layerManager: LayerManager | null = null;
  if (layersContainer && config.ui?.layers?.enabled !== false) {
    layerManager = new LayerManager({
      container: layersContainer,
      onSelect: (component) => {
        // Notify iframe to select this component
        const id = component.attributes?.id;
        if (id) {
          iframe.contentWindow?.postMessage({
            type: 'editorts:selectComponent',
            id: id
          }, '*');
        }

        // Emit event
        emit('componentSelect', component);
        if (config.onComponentSelect) {
          config.onComponentSelect(component);
        }
      },
      onReorder: (componentId, newParentId, newIndex) => {
        // Reorder in component manager
        page.components.moveComponent(componentId, newParentId, newIndex);

        // Emit event
        const component = page.components.findById(componentId);
        if (component) {
          emit('componentReorder', component, newParentId, newIndex);
        }

        void commitSnapshot({ source: 'user', message: 'reorder component' });

        // Refresh iframe
        refresh();
      }
    });

    // Initial render
    layerManager.update(page.components.getAll());
  }

  const renderStats = () => {
    if (!statsContainer || config.ui?.stats?.enabled === false) return;

    statsContainer.innerHTML = `
      <div style="font-size: 0.85rem;">
        <div>Components: ${page.components.count()}</div>
        <div>Styles: ${page.styles.count()}</div>
        <div>Assets: ${page.assets.count()}</div>
      </div>
    `;
  };

  // Populate stats if container provided
  renderStats();

  // Populate multipage dropdown (if enabled)
  // Actual render function is defined later; we call it from refresh().

  const setAiChatExpanded = (expanded: boolean) => {
    if (!shouldEnableAiChatUi) return;

    const root = aiChatRoot ?? aiChatExpandButton?.closest('[data-editorts-ai-chat-root]') as HTMLElement | null;
    if (!root) return;

    root.dataset.editortsAiChatExpanded = expanded ? 'true' : 'false';

    const expandedClassName = aiChatConfig?.expandedClassName ?? 'editorts-ai-chat-expanded';
    const collapsedClassName = aiChatConfig?.collapsedClassName ?? 'editorts-ai-chat-collapsed';

    root.classList.toggle(expandedClassName, expanded);
    root.classList.toggle(collapsedClassName, !expanded);

    if (aiChatExpandButton) {
      aiChatExpandButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  };

  if (shouldEnableAiChatUi && aiChatExpandButton) {
    const initial = aiChatConfig?.defaultExpanded === true;
    setAiChatExpanded(initial);

    addManagedEventListener(aiChatExpandButton, 'click', () => {
      const root = aiChatRoot ?? (aiChatExpandButton.closest('[data-editorts-ai-chat-root]') as HTMLElement | null);
      const current = root?.dataset.editortsAiChatExpanded === 'true';
      setAiChatExpanded(!current);
    });
  }

  // Initialize storage manager early so AI UI helpers can access it.
  const storage = new StorageManager(config.storage);

  // Command palette state
  const commandPaletteConfig = config.ui?.commandPalette;
  const commandPaletteEnabled = commandPaletteConfig?.enabled !== false
    && !!commandPaletteContainer
    && !!commandPaletteInput
    && !!commandPaletteResults;

  let isCommandPaletteOpen = false;
  type CommandPaletteEntry = {
    kind: 'component' | 'command';
    type?: string;
    label: string;
    action: () => void | Promise<void>;
  };

  let commandPaletteEntries: CommandPaletteEntry[] = [];
  let commandPaletteActiveIndex = 0;
  let isRenderingCommandPalette = false;
  let renderCommandPaletteResults = (): void => { };
  let openCommandPalette = (): void => { };
  let closeCommandPalette = (): void => { };

  // Optional AI provider module (lazy)
  let ai: EditorTsAiModule | undefined;

  if (config.aiProvider?.provider === 'opencode') {
    const aiConfig: OpencodeAiProviderConfig = config.aiProvider;
    const mode: AiProviderMode = aiConfig.mode ?? 'client';

    const externalClient = aiConfig.client;
    const externalServer = aiConfig.server;

    let server: OpencodeServer | null = null;
    let clientPromise: Promise<import('@opencode-ai/sdk/client').OpencodeClient> | null = null;
    let activeBaseUrl: string | null = null;

    const resolveConfiguredAiBaseUrl = (): string => {
      const rawBaseUrl = (aiBaseUrlInput?.value || aiConfig.baseUrl || aiProxiedBaseUrl).trim();
      if (rawBaseUrl.startsWith('http://') || rawBaseUrl.startsWith('https://')) {
        return rawBaseUrl.replace(/\/+$/, '');
      }

      return new URL(rawBaseUrl.startsWith('/') ? rawBaseUrl : `/${rawBaseUrl}`, window.location.origin)
        .toString()
        .replace(/\/+$/, '');
    };

    const getAiStorageKeys = () => {
      const configuredNamespace = typeof aiConfig.sessions?.storageNamespace === 'string'
        ? aiConfig.sessions.storageNamespace.trim()
        : '';
      const namespaceSource = configuredNamespace.length > 0
        ? `${resolveConfiguredAiBaseUrl()}::${configuredNamespace}`
        : resolveConfiguredAiBaseUrl();
      const namespace = encodeURIComponent(namespaceSource);
      return {
        sessions: `ai_sessions:${namespace}`,
        current: `ai_session_current:${namespace}`,
        legacySessions: 'ai_sessions',
        legacyCurrent: 'ai_session_current',
      };
    };

    const invalidateAiClient = () => {
      if (externalClient || mode !== 'client') return;
      clientPromise = null;
      activeBaseUrl = null;
      currentSessionId = null;
    };

    const loadClientSdk = async (): Promise<OpencodeClientSdkModule> => {
      return import('@opencode-ai/sdk/client');
    };

    const loadServerSdk = async (): Promise<OpencodeServerSdkModule> => {
      if (typeof window !== 'undefined') {
        throw new Error("EditorTs: aiProvider.mode = 'client+server' requires a server-capable runtime");
      }

      const serverModuleId = '@opencode-ai/sdk/server';
      return import(/* @vite-ignore */ serverModuleId) as Promise<OpencodeServerSdkModule>;
    };

    let currentSessionId: string | null = null;

    const loadSessionIndex = async (): Promise<{ current: string | null; sessions: Array<{ id: string; title?: string }> }> => {
      const keys = getAiStorageKeys();
      const rawSessions = await storage.loadPage(keys.sessions) ?? await storage.loadPage(keys.legacySessions);
      const rawCurrent = await storage.loadPage(keys.current) ?? await storage.loadPage(keys.legacyCurrent);

      let sessions: Array<{ id: string; title?: string }> = [];
      if (rawSessions) {
        try {
          const parsed = JSON.parse(rawSessions) as unknown;
          if (Array.isArray(parsed)) {
            sessions = parsed
              .filter((s): s is { id: string; title?: string } => typeof (s as { id?: unknown }).id === 'string')
              .map((s) => ({ id: s.id, title: typeof s.title === 'string' ? s.title : undefined }));
          }
        } catch {
          // ignore
        }
      }

      let current: string | null = null;
      if (rawCurrent) {
        try {
          const parsed = JSON.parse(rawCurrent) as unknown;
          current = typeof parsed === 'string' && parsed.length > 0 ? parsed : null;
        } catch {
          // ignore
        }
      }

      return { current, sessions };
    };

    const ensureCurrentSessionLoaded = async (): Promise<string | null> => {
      if (currentSessionId !== null) {
        return currentSessionId;
      }

      const index = await loadSessionIndex();
      currentSessionId = index.current;
      return currentSessionId;
    };

    const saveSessionIndex = async (next: { current: string | null; sessions: Array<{ id: string; title?: string }> }) => {
      const keys = getAiStorageKeys();
      await storage.savePage(keys.sessions, JSON.stringify(next.sessions, null, 2));
      await storage.savePage(keys.current, JSON.stringify(next.current));
    };

    const appendAiChatLog = (label: string, text: string) => {
      if (!aiChatLog) return;
      aiChatLog.textContent = `${aiChatLog.textContent ?? ''}${label}: ${text}\n\n`;
    };

    const replaceAiChatStreamingMessage = (prefix: string, text: string) => {
      if (!aiChatLog) return;
      aiChatLog.textContent = `${prefix}assistant: ${text}`;
    };

    const extractTextFromParts = (parts: Array<{ type: string; text?: string }>): string => {
      return parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('');
    };

    const formatAiChatPathSummary = (paths: string[]): string => {
      if (paths.length === 0) {
        return 'file replacements';
      }

      if (paths.length <= 3) {
        return paths.join(', ');
      }

      return `${paths.slice(0, 3).join(', ')} +${paths.length - 3} more`;
    };

    const formatAiChatTranscript = (
      messages: Array<{
        info: { role: string };
        parts: Array<{ type: string; text?: string }>;
      }>
    ): string => {
      const blocks = messages.flatMap((entry) => {
        const rawText = extractTextFromParts(entry.parts);
        const text = entry.info.role === 'assistant'
          ? summarizeAiAssistantText(rawText).trim()
          : extractAiChatRequestText(rawText).trim();
        if (!text) return [];
        const label = entry.info.role === 'assistant' ? 'assistant' : 'user';
        return [`${label}: ${text}`];
      });

      if (blocks.length === 0) return '';
      return `${blocks.join('\n\n')}\n\n`;
    };

    const loadAiSessionTranscript = async (sessionId: string | null) => {
      if (!aiChatLog) return;

      if (!sessionId) {
        aiChatLog.textContent = '';
        return;
      }

      if (!ai) return;

      try {
        const client = await ai.getClient();
        const result = await client.session.messages({
          path: { id: sessionId },
          query: { limit: 100 },
        });

        const messages = Array.isArray(result.data)
          ? (result.data as Array<{
            info: { role: string; time?: { created?: number } };
            parts: Array<{ type: string; text?: string }>;
          }>)
          : [];

        const ordered = messages.sort((a, b) => {
          const left = typeof a.info.time?.created === 'number' ? a.info.time.created : 0;
          const right = typeof b.info.time?.created === 'number' ? b.info.time.created : 0;
          return left - right;
        });

        aiChatLog.textContent = formatAiChatTranscript(ordered);
      } catch (err: unknown) {
        aiChatLog.textContent = '';
        appendAiChatLog('error', err instanceof Error ? err.message : String(err));
      }
    };

    const setAiChatPending = (pending: boolean) => {
      if (!aiChatLog) return;
      if (pending) {
        aiChatLog.setAttribute('data-pending', 'true');
      } else {
        aiChatLog.removeAttribute('data-pending');
      }
    };

    const setAiChatStatus = (state: 'idle' | 'loading' | 'streaming' | 'success' | 'error', text: string) => {
      if (!aiChatStatus) return;
      aiChatStatus.dataset.state = state;
      aiChatStatus.textContent = text;
    };

    const collectFallbackComponentScripts = (): Record<string, string> => {
      const scripts: Record<string, string> = {};

      const collect = (components: Component[]) => {
        components.forEach((component) => {
          const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
          if (id) {
            scripts[`components/${id}.js`] = typeof component.script === 'string' ? component.script : '';
          }
          if (component.components && component.components.length > 0) {
            collect(component.components);
          }
        });
      };

      collect(page.components.getAll());
      return scripts;
    };

    const buildAiWorkspaceFiles = async (): Promise<{
      files: Record<string, string>;
      editablePaths: string[];
      readOnlyPaths: string[];
    }> => {
      if (typeof contentAdapter.buildAiWorkspace === 'function') {
        const projected = await contentAdapter.buildAiWorkspace();
        return {
          files: projected.files,
          editablePaths: projected.editablePaths,
          readOnlyPaths: projected.readOnlyPaths,
        };
      }

      const files: Record<string, string> = {};
      const editablePaths: string[] = [];
      const readOnlyPaths: string[] = [];

      try {
        const listed = await contentAdapter.listFiles();

        for (const file of listed) {
          const content = await contentAdapter.readFile(file.path);
          if (content === null) continue;

          files[file.path] = content;

          if (file.readOnly) {
            readOnlyPaths.push(file.path);
          } else {
            editablePaths.push(file.path);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('EditorTs: failed to build AI workspace from content adapter:', message);
      }

      if (Object.keys(files).length === 0) {
        files['page.json'] = save();
        files['styles.css'] = page.getCSS() ?? '';

        const scripts = collectFallbackComponentScripts();
        Object.entries(scripts).forEach(([path, content]) => {
          files[path] = content;
        });

        editablePaths.push(...Object.keys(files));
      }

      return {
        files,
        editablePaths: Array.from(new Set(editablePaths)).sort((a, b) => a.localeCompare(b)),
        readOnlyPaths: Array.from(new Set(readOnlyPaths)).sort((a, b) => a.localeCompare(b)),
      };
    };

    type StoredAiSession = { id: string; title?: string };

    const mergeStoredAiSessions = (
      primary: StoredAiSession[],
      secondary: StoredAiSession[],
    ): StoredAiSession[] => {
      const merged = new Map<string, StoredAiSession>();

      [...primary, ...secondary].forEach((session) => {
        if (!session.id.trim()) return;

        const existing = merged.get(session.id);
        if (!existing) {
          merged.set(session.id, session);
          return;
        }

        if (!existing.title && session.title) {
          merged.set(session.id, session);
        }
      });

      return Array.from(merged.values()).slice(0, 50);
    };

    const hydrateAiSession = async (sessionId: string): Promise<StoredAiSession | null> => {
      if (!ai || !sessionId.trim()) return null;

      try {
        const client = await ai.getClient();
        const result = await client.session.get({ path: { id: sessionId } });
        const data = result.data as { id?: unknown; title?: unknown } | null | undefined;

        if (!data || typeof data.id !== 'string' || !data.id.trim()) {
          return null;
        }

        return {
          id: data.id,
          title: typeof data.title === 'string' && data.title.trim() ? data.title : undefined,
        };
      } catch {
        return null;
      }
    };

    const listRemoteAiSessions = async (): Promise<StoredAiSession[] | null> => {
      if (!ai) return null;
      if (aiConfig.sessions?.hydrateRemoteList === false) {
        return null;
      }

      try {
        const client = await ai.getClient();
        const result = await client.session.list();
        const sessions = Array.isArray(result.data)
          ? (result.data as Array<{ id?: unknown; title?: unknown; time?: { updated?: unknown; created?: unknown } }>)
          : [];

        return sessions
          .filter((session): session is { id: string; title?: unknown; time?: { updated?: unknown; created?: unknown } } => {
            return typeof session.id === 'string' && session.id.trim().length > 0;
          })
          .sort((left, right) => {
            const leftUpdated = typeof left.time?.updated === 'number'
              ? left.time.updated
              : typeof left.time?.created === 'number'
                ? left.time.created
                : 0;
            const rightUpdated = typeof right.time?.updated === 'number'
              ? right.time.updated
              : typeof right.time?.created === 'number'
                ? right.time.created
                : 0;
            return rightUpdated - leftUpdated;
          })
          .map((session) => ({
            id: session.id,
            title: typeof session.title === 'string' && session.title.trim() ? session.title : undefined,
          }))
          .slice(0, 50);
      } catch {
        return null;
      }
    };

    const refreshAiSessionSelect = async () => {
      if ((!aiSessionSelect && !aiSessionList) || !ai) return;

      const sessions = await ai.sessions.list();
      const current = await ensureCurrentSessionLoaded();

      if (aiSessionSelect) {
        aiSessionSelect.innerHTML = '';
      }

      if (aiSessionList) {
        aiSessionList.innerHTML = '';
      }

      const addOption = (id: string, label: string) => {
        if (aiSessionSelect) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = label;
          if (id === current) {
            opt.selected = true;
          }
          aiSessionSelect.appendChild(opt);
        }

        if (aiSessionList) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'editorts-ai-session-item';
          if (id === current || (!id && !current)) {
            button.classList.add('editorts-ai-session-item-active');
          }
          button.textContent = label;
          button.addEventListener('click', async () => {
            if (!ai) return;
            await ai.sessions.setCurrent(id.length ? id : null);
            await refreshAiSessionSelect();
            await loadAiSessionTranscript(id.length ? id : null);
          });
          aiSessionList.appendChild(button);
        }
      };

      addOption('', '(auto)');

      sessions.forEach((s) => {
        addOption(s.id, s.title ? `${s.title} (${s.id})` : s.id);
      });
    };

    const refreshAiModelSelect = async () => {
      if (!aiModelSelect || !ai) return;

      const models = await ai.models.list();
      const previousValue = aiModelSelect.value;
      aiModelSelect.innerHTML = '';

      const addModelOption = (value: string, label: string) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        aiModelSelect.appendChild(opt);
      };

      models.forEach((model) => {
        addModelOption(encodeAiModelSelectValue(model), formatAiModelOptionLabel(model));
      });

      if (models.length === 0) {
        addModelOption('', 'No models');
      } else if (previousValue && Array.from(aiModelSelect.options).some((opt) => opt.value === previousValue)) {
        aiModelSelect.value = previousValue;
      }
    };

    let lastAiReplacements: Array<{ path: string; content: string }> | null = null;

    ai = {
      provider: 'opencode',
      mode,
      getClient: async () => {
        if (!externalClient && mode === 'client') {
          const requestedBaseUrl = resolveConfiguredAiBaseUrl();
          if (activeBaseUrl !== requestedBaseUrl) {
            clientPromise = null;
            activeBaseUrl = requestedBaseUrl;
          }
        }

        if (!clientPromise) {
          if (externalClient) {
            clientPromise = Promise.resolve(externalClient);
          } else {
            clientPromise = (mode === 'client' ? loadClientSdk() : loadServerSdk()).then(async (sdk) => {
              if (mode === 'client') {
                const baseUrl = resolveConfiguredAiBaseUrl();
                activeBaseUrl = baseUrl;
                if (!baseUrl) {
                  throw new Error("EditorTs: aiProvider.baseUrl is required when mode is 'client'");
                }
                if (typeof sdk.createOpencodeClient !== 'function') {
                  throw new Error('EditorTs: @opencode-ai/sdk missing createOpencodeClient');
                }

                const createAuthedFetch = (username: string, password: string): ((request: Request) => Promise<Response>) => {
                  const basic = btoa(`${username}:${password}`);

                  return async (request: Request): Promise<Response> => {
                    const headers = new Headers(request.headers);
                    headers.set('Authorization', `Basic ${basic}`);
                    const nextRequest = new Request(request, { headers });
                    return fetch(nextRequest);
                  };
                };

                // If the app is using a same-origin proxy (like /opencode/*), do NOT send basic auth
                // from the browser; let the proxy attach it.
                const auth = baseUrl.startsWith(window.location.origin)
                  ? undefined
                  : aiConfig.auth;

                return sdk.createOpencodeClient({
                  baseUrl,
                  fetch: auth ? createAuthedFetch(auth.username ?? 'opencode', auth.password) : undefined,
                });
              }

              if (!('createOpencode' in sdk) || typeof sdk.createOpencode !== 'function') {
                throw new Error('EditorTs: @opencode-ai/sdk missing createOpencode');
              }

              const opencode = await sdk.createOpencode({
                hostname: aiConfig.hostname,
                port: aiConfig.port,
                signal: aiConfig.signal,
                timeout: aiConfig.timeout,
                config: aiConfig.config ?? {},
              });

              server = opencode.server;
              return opencode.client;
            });
          }
        }

        return clientPromise;
      },
      getUrl: () => {
        if (mode === 'client') {
          if (activeBaseUrl) return activeBaseUrl;
          if (aiBaseUrlInput?.value?.trim()) return resolveConfiguredAiBaseUrl();
          return aiConfig.baseUrl ?? externalServer?.url ?? null;
        }
        return server?.url ?? externalServer?.url ?? null;
      },
      sessions: {
        current: () => {
          return currentSessionId;
        },
        setCurrent: async (sessionId: string | null) => {
          currentSessionId = sessionId;
          const index = await loadSessionIndex();
          let nextSessions = index.sessions;

          if (sessionId && !nextSessions.some((session) => session.id === sessionId)) {
            const hydrated = await hydrateAiSession(sessionId);
            nextSessions = [
              hydrated ?? { id: sessionId },
              ...nextSessions,
            ].slice(0, 50);
          }

          await saveSessionIndex({ current: sessionId, sessions: nextSessions });
        },
        list: async () => {
          const index = await loadSessionIndex();
          if (currentSessionId === null && index.current) {
            currentSessionId = index.current;
          }

          const remoteSessions = await listRemoteAiSessions();
          let nextSessions = remoteSessions
            ? mergeStoredAiSessions(remoteSessions, index.sessions)
            : index.sessions;

          const current = currentSessionId ?? index.current;
          if (current && !nextSessions.some((session) => session.id === current)) {
            const hydratedCurrent = await hydrateAiSession(current);
            if (hydratedCurrent) {
              nextSessions = mergeStoredAiSessions([hydratedCurrent], nextSessions);
            }
          }

          if (JSON.stringify(nextSessions) !== JSON.stringify(index.sessions)) {
            await saveSessionIndex({
              current,
              sessions: nextSessions,
            });
          }

          return nextSessions;
        },
        create: async (title?: string) => {
          const client = await ai!.getClient();
          const result = await client.session.create({ body: { title: title ?? 'EditorTs Chat' } });
          if (!result.data) {
            throw new Error(`Failed to create session: ${String(result.error)}`);
          }

          const created = { id: result.data.id, title: result.data.title };

          const index = await loadSessionIndex();
          const nextSessions = [created, ...index.sessions.filter((s) => s.id !== created.id)].slice(0, 50);
          await saveSessionIndex({ current: created.id, sessions: nextSessions });

          return created;
        },
        reset: async () => {
          currentSessionId = null;
          await saveSessionIndex({ current: null, sessions: [] });
        },
      },
      models: {
        list: async () => {
          const result: Array<{ providerID: string; modelID: string }> = [];

          const addModel = (providerID: string, modelID: string) => {
            const normalized = normalizeOpencodeModelId(providerID, modelID);
            if (!result.some((entry) => entry.providerID === providerID && entry.modelID === normalized)) {
              result.push({ providerID, modelID: normalized });
            }
          };

          addModel('opencode', 'gpt-5.4');
          addModel('opencode', 'claude-opus-4-6');
          addModel('opencode', 'gemini-3.1-pro');

          try {
            const client = await ai!.getClient();
            const configured = await client.config.get();
            const configuredModel = typeof configured.data?.model === 'string'
              ? parseAiModelRef(configured.data.model)
              : undefined;
            if (configuredModel) {
              addModel(configuredModel.providerID, configuredModel.modelID);
            }

            const providers = await client.config.providers();
            const defaults = readProviderDefaultModels(providers.data?.default);
            if (defaults.openai) {
              addModel('openai', 'gpt-5.4');
            }

            for (const [providerID, modelID] of Object.entries(defaults)) {
              addModel(providerID, modelID);
            }
          } catch {
            // ignore provider lookup failures
          }

          return result;
        },
      },

      chat: async (
        prompt: string,
        options?: {
          sessionId?: string;
          model?: {
            providerID: string;
            modelID: string;
          };
          stream?: boolean;
          onStream?: (delta: string) => void;
        }
      ) => {
        const client = await ai!.getClient();

        const workspaceSnapshot = await buildAiWorkspaceFiles();

        const sessionId = options?.sessionId ?? currentSessionId;

        const shouldStream = options?.stream ?? aiConfig.stream?.enabled === true;
        const selectedModel = options?.model;

        const result = await requestAiReplacements({
          client,
          prompt,
          workspaceFiles: workspaceSnapshot.files,
          allowedPaths: workspaceSnapshot.editablePaths,
          readOnlyPaths: workspaceSnapshot.readOnlyPaths,
          sessionId: sessionId ?? undefined,
          model: selectedModel,
          stream: shouldStream,
          onStream: options?.onStream,
        });

        // Persist session for reuse.
        if (result.sessionId) {
          currentSessionId = result.sessionId;
          const index = await loadSessionIndex();
          const hydrated = await hydrateAiSession(result.sessionId);
          const nextSessions = [
            hydrated ?? { id: result.sessionId },
            ...index.sessions.filter((s) => s.id !== result.sessionId),
          ].slice(0, 50);
          await saveSessionIndex({ current: result.sessionId, sessions: nextSessions });
        }

        return result;
      },
      apply: async (replacements) => {
        const workspaceSnapshot = await buildAiWorkspaceFiles();
        const editablePathSet = new Set(workspaceSnapshot.editablePaths);

        const result = await applyAiReplacementsToFiles({
          replacements,
          isPathAllowed: editablePathSet.size > 0 ? (path) => editablePathSet.has(path) : undefined,
          saveFile: async (path: string, content: string) => {
            await contentAdapter.writeFile(path, content);
          },
        });

        if (result.skippedPaths.length > 0) {
          console.warn(`EditorTs: skipped AI replacements for non-editable paths: ${result.skippedPaths.join(', ')}`);
        }

        const latestSnapshot = await contentAdapter.load();
        applyPayload(latestSnapshot.data);

        await commitSnapshot({ source: 'ai', message: 'apply ai changes' });

        refresh();
        refreshLayers();
      },
      close: async () => {
        // Only close server that EditorTs started itself.
        if (server) {
          server.close();
        }
        server = null;
      },


    };

    // Wire AI Chat UI controls, if the app provided them.
    if (shouldEnableAiChatUi) {
      const autoApply = aiChatConfig?.autoApply !== false;
      const streamEnabled = aiChatConfig?.stream?.enabled ?? aiConfig.stream?.enabled === true;

      const refreshAiChatLink = () => {
        if (!aiChatLinkAnchor) return;

        const path = aiChatConfig?.link?.path ?? '/chats';

        const baseUrl = ai?.getUrl() ?? aiBaseUrlInput?.value ?? aiConfig.baseUrl ?? aiProxiedBaseUrl;
        const resolvedBase = baseUrl.startsWith('http')
          ? baseUrl
          : `${window.location.origin}${baseUrl.startsWith('/') ? '' : '/'}${baseUrl}`;

        const nextUrl = new URL(path.startsWith('/') ? path : `/${path}`, resolvedBase);
        aiChatLinkAnchor.href = nextUrl.toString();
        aiChatLinkAnchor.target = '_blank';
        aiChatLinkAnchor.rel = 'noopener noreferrer';
      };

      if (aiBaseUrlInput && !aiBaseUrlInput.value.trim()) {
        aiBaseUrlInput.value = aiConfig.baseUrl ?? aiProxiedBaseUrl;
      }

      if (aiBaseUrlInput) {
        addManagedEventListener(aiBaseUrlInput, 'input', () => {
          invalidateAiClient();
          if (aiHealthStatus) {
            aiHealthStatus.textContent = '';
          }
          void refreshAiSessionSelect();
          void refreshAiModelSelect();
          refreshAiChatLink();
        });
      }

      refreshAiChatLink();
      setAiChatStatus('idle', 'Ready');

      if (aiHealthButton && aiHealthStatus) {
        addManagedEventListener(aiHealthButton, 'click', async () => {
          if (!ai) {
            aiHealthStatus.textContent = 'AI provider is disabled.';
            return;
          }

          aiHealthStatus.textContent = 'Checking...';
          setAiChatStatus('loading', 'Checking AI connection...');

          try {
            const client = await ai.getClient();
            const result = await client.config.get();
            aiHealthStatus.textContent = JSON.stringify(result.data ?? result, null, 2);
            setAiChatStatus('success', 'AI connection ready');
          } catch (err: unknown) {
            aiHealthStatus.textContent = err instanceof Error ? err.message : String(err);
            setAiChatStatus('error', 'AI connection failed');
          }
        });
      }

      if (aiSessionSelect || aiSessionList) {
        void refreshAiSessionSelect();
      }

      if (aiSessionSelect) {
        addManagedEventListener(aiSessionSelect, 'change', async () => {
          if (!ai) return;
          const next = aiSessionSelect.value.trim();
          await ai.sessions.setCurrent(next.length ? next : null);
          await refreshAiSessionSelect();
          await loadAiSessionTranscript(next.length ? next : null);
        });
      }

      if (aiModelSelect) {
        void refreshAiModelSelect();
      }

      void ensureCurrentSessionLoaded().then((sessionId) => {
        if (sessionId) {
          return loadAiSessionTranscript(sessionId);
        }
        return undefined;
      });

      if (aiSessionNewButton) {
        addManagedEventListener(aiSessionNewButton, 'click', async () => {
          if (!ai) return;
          const created = await ai.sessions.create('EditorTs Chat');
          await ai.sessions.setCurrent(created.id);
          await refreshAiSessionSelect();
          if (aiChatLog) aiChatLog.textContent = '';
          if (aiChatInput) aiChatInput.value = '';
          lastAiReplacements = null;
          aiChatApplyButton?.toggleAttribute('disabled', true);
          setAiChatStatus('success', 'Started a fresh chat session');
        });
      }

      if (aiSessionResetButton) {
        addManagedEventListener(aiSessionResetButton, 'click', async () => {
          if (!ai) return;
          await ai.sessions.reset();
          await refreshAiSessionSelect();
          if (aiChatLog) aiChatLog.textContent = '';
          if (aiChatInput) aiChatInput.value = '';
          if (aiHealthStatus) aiHealthStatus.textContent = '';
          lastAiReplacements = null;
          aiChatApplyButton?.toggleAttribute('disabled', true);
          setAiChatStatus('idle', 'Chat state reset');
        });
      }

      if (aiChatApplyButton) {
        addManagedEventListener(aiChatApplyButton, 'click', async () => {
          if (!lastAiReplacements || lastAiReplacements.length === 0) return;
          if (!ai) {
            appendAiChatLog('error', 'AI provider is disabled.');
            return;
          }

          try {
            await ai.apply(lastAiReplacements);
            appendAiChatLog('apply', `Applied ${lastAiReplacements.length} replacement(s).`);
            lastAiReplacements = null;
            aiChatApplyButton.toggleAttribute('disabled', true);
            setAiChatStatus('success', 'Applied last reply');
          } catch (err: unknown) {
            appendAiChatLog('error', err instanceof Error ? err.message : String(err));
            setAiChatStatus('error', 'Apply failed');
          }
        });
      }

      if (aiChatSendButton && aiChatInput) {
        addManagedEventListener(aiChatSendButton, 'click', async () => {
          if (!ai) {
            appendAiChatLog('error', 'AI provider is disabled.');
            return;
          }

          const prompt = aiChatInput.value.trim();
          if (!prompt) return;

          appendAiChatLog('user', prompt);
          setAiChatPending(true);
          aiChatSendButton.toggleAttribute('disabled', true);
          const previousSendLabel = aiChatSendButton.textContent;
          aiChatSendButton.textContent = 'Thinking...';
          setAiChatStatus('loading', 'Waiting for OpenCode reply...');

          try {
            const selectedSessionId = aiSessionSelect?.value?.trim() || ai.sessions.current() || undefined;

            let streamedText = '';
            const logPrefix = aiChatLog?.textContent ?? '';
            if (streamEnabled && aiChatLog) {
              replaceAiChatStreamingMessage(logPrefix, 'Preparing file replacements...');
              setAiChatStatus('streaming', 'Streaming file changes...');
            }

            const selectedModelValue = aiModelSelect?.value?.trim() || '';
            const model = selectedModelValue ? parseAiModelRef(selectedModelValue) : undefined;

            const result = await ai.chat(prompt, {
              sessionId: selectedSessionId,
              model,
              stream: streamEnabled,
              onStream: streamEnabled
                ? (delta) => {
                  streamedText += delta;
                  setAiChatPending(false);
                  const streamedPaths = extractAiReplacementPaths(streamedText);
                  const streamingMessage = streamedPaths.length > 0
                    ? `Preparing ${streamedPaths.length} file change${streamedPaths.length === 1 ? '' : 's'}: ${formatAiChatPathSummary(streamedPaths)}`
                    : 'Preparing file replacements...';
                  replaceAiChatStreamingMessage(logPrefix, streamingMessage);
                  setAiChatStatus(
                    'streaming',
                    streamedPaths.length > 0
                      ? `Streaming ${streamedPaths.length} file change${streamedPaths.length === 1 ? '' : 's'}...`
                      : 'Streaming file changes...'
                  );
                }
                : undefined,
            });

            const assistantSummary = summarizeAiAssistantText(result.rawText);

            if (streamEnabled && aiChatLog) {
              aiChatLog.textContent = logPrefix;
              setAiChatPending(false);
              if (assistantSummary.trim()) {
                appendAiChatLog('assistant', assistantSummary);
              }
            } else {
              setAiChatPending(false);
              if (assistantSummary.trim()) {
                appendAiChatLog('assistant', assistantSummary);
              }
            }

            await refreshAiSessionSelect();

            if (result.warnings && result.warnings.length > 0) {
              result.warnings.forEach((warning) => {
                appendAiChatLog('warning', warning);
              });
            }

            if (result.replacements.length === 0) {
              lastAiReplacements = null;
              aiChatApplyButton?.toggleAttribute('disabled', true);
              setAiChatStatus('success', 'Reply ready');
              return;
            }

            if (!autoApply) {
              lastAiReplacements = result.replacements;
              aiChatApplyButton?.toggleAttribute('disabled', false);
              setAiChatStatus('success', 'Reply ready - review before apply');
              return;
            }

            try {
              setAiChatStatus('loading', 'Applying AI changes...');
              await ai.apply(result.replacements);
              appendAiChatLog('apply', `Applied ${result.replacements.length} replacement(s).`);
              lastAiReplacements = null;
              aiChatApplyButton?.toggleAttribute('disabled', true);
              setAiChatStatus('success', `Applied ${result.replacements.length} change${result.replacements.length === 1 ? '' : 's'}`);
            } catch (err: unknown) {
              lastAiReplacements = result.replacements;
              aiChatApplyButton?.toggleAttribute('disabled', false);
              appendAiChatLog('error', err instanceof Error ? err.message : String(err));
              setAiChatStatus('error', 'Reply ready - apply failed');
            }
          } catch (err: unknown) {
            setAiChatPending(false);
            appendAiChatLog('error', err instanceof Error ? err.message : String(err));
            setAiChatStatus('error', err instanceof Error ? err.message : String(err));
          } finally {
            setAiChatPending(false);
            aiChatSendButton.toggleAttribute('disabled', false);
            aiChatSendButton.textContent = previousSendLabel;
          }
        });
      }
    }

  }

  // Built-in code editor setup (optional)
  const codeEditorProvider = config.codeEditor?.provider ?? 'textarea';

  type RuntimeCodeEditor = {
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
    dispose(): void;
  };

  type RuntimeCodeEditorOptions = {
    readOnly?: boolean;
  };

  function createTextareaCodeEditor(
    host: HTMLElement,
    initialValue: string,
    options?: RuntimeCodeEditorOptions
  ): RuntimeCodeEditor {
    host.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.value = initialValue;
    textarea.spellcheck = false;
    if (options?.readOnly) {
      textarea.readOnly = true;
    }
    textarea.style.width = '100%';
    textarea.style.height = '100%';
    textarea.style.minHeight = '0';
    textarea.style.fontFamily = 'monospace';
    textarea.style.fontSize = '0.9rem';

    host.appendChild(textarea);

    return {
      getValue: () => textarea.value,
      setValue: (value: string) => {
        textarea.value = value;
      },
      focus: () => textarea.focus(),
      dispose: () => {
        textarea.remove();
      },
    };
  }

  type ModernMonacoModule = typeof import('modern-monaco');
  type ModernMonaco = Awaited<ReturnType<ModernMonacoModule['init']>>;

  let modernMonacoInitPromise: Promise<ModernMonaco> | null = null;

  type MonacoWorkspace = import('modern-monaco').Workspace;

  const workspaceEnabled = codeEditorProvider === 'modern-monaco' && config.codeEditor?.workspace?.enabled !== false;
  const workspaceName = config.codeEditor?.workspace?.name ?? 'editorts';

  // Workspace variables are initialized now; code tab hooks are safe.
  codeTabHooksReady = true;

  let workspace: MonacoWorkspace | null = null;

  const buildWorkspaceFiles = (): Record<string, string> => {
    const files: Record<string, string> = {};

    files['page.json'] = save();
    files['styles.css'] = page.getCSS() ?? '';
    files['index.html'] = `<!DOCTYPE html><html><head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>${page.getHTML()}</html>`;

    // Per-component scripts
    const collect = (components: Component[]) => {
      components.forEach((component) => {
        const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
        if (id) {
          const content = typeof component.script === 'string' ? component.script : '';
          files[`components/${id}.js`] = content;
        }
        if (component.components && component.components.length > 0) {
          collect(component.components);
        }
      });
    };

    collect(page.components.getAll());

    return files;
  };

  const ensureWorkspace = async (mod: ModernMonacoModule): Promise<MonacoWorkspace | null> => {
    if (!workspaceEnabled) return null;
    if (workspace) return workspace;

    const files = buildWorkspaceFiles();
    workspace = new mod.Workspace({
      name: workspaceName,
      initialFiles: files,
      entryFile: 'index.html',
    });

    return workspace;
  };

  async function syncWorkspaceFiles(): Promise<void> {
    if (!workspace) return;

    const files = buildWorkspaceFiles();
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await workspace!.fs.writeFile(path, content, { isModelContentChange: false });
      })
    );
  }

  async function loadModernMonaco(mod: ModernMonacoModule, ws: MonacoWorkspace | null): Promise<ModernMonaco> {
    if (!modernMonacoInitPromise) {
      modernMonacoInitPromise = (async () => {
        if (typeof mod.init !== 'function') {
          throw new Error('modern-monaco missing init() export');
        }

        // Ensure builtin LSP is enabled even if MonacoEnvironment was overwritten.
        const globalWithEnv = globalThis as unknown as { MonacoEnvironment?: Record<string, unknown> };
        globalWithEnv.MonacoEnvironment = {
          ...(globalWithEnv.MonacoEnvironment ?? {}),
          useBuiltinLSP: true,
        };

        return mod.init({
          workspace: ws ?? undefined,
          // Enable built-in language services (JS/TS/CSS/JSON/HTML).
          lsp: {
            typescript: {},
            css: {},
            json: {
              // Provide a minimal schema so page.json completions are obvious.
              schemas: [
                {
                  uri: 'https://editorts.dev/schemas/page.json',
                  fileMatch: ['page.json'],
                  schema: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      item_id: { type: 'number' },
                      body: { type: 'object' },
                    },
                  },
                },
              ],
            },
            html: {},
          },
        });
      })();
    }

    return modernMonacoInitPromise;
  }

  async function createModernMonacoCodeEditor(
    host: HTMLElement,
    initialValue: string,
    language: 'javascript' | 'typescript' | 'css' | 'json',
    options?: RuntimeCodeEditorOptions
  ): Promise<RuntimeCodeEditor> {
    host.innerHTML = '';

    const monacoHost = document.createElement('div');
    monacoHost.style.width = '100%';
    monacoHost.style.height = '100%';
    monacoHost.style.minHeight = '0';
    host.appendChild(monacoHost);

    const mod = await import('modern-monaco');
    const ws = await ensureWorkspace(mod);

    const monaco = await loadModernMonaco(mod, ws);

    const editor = monaco.editor.create(monacoHost, {
      automaticLayout: true,
      minimap: { enabled: false },
      readOnly: options?.readOnly === true,
    });

    const openFile = async (path: string, fallback: string): Promise<ReturnType<typeof monaco.editor.createModel>> => {
      if (ws) {
        await ws.fs.writeFile(path, fallback, { isModelContentChange: false });

        // modern-monaco's public `openTextDocument()` opens in the first editor.
        // We need to open into *this* editor instance.
        const internal = ws as unknown as {
          _openTextDocument?: (
            uri: string,
            editor: ReturnType<typeof monaco.editor.create>,
            selectionOrPosition?: unknown,
            readonlyContent?: string
          ) => Promise<ReturnType<typeof monaco.editor.createModel>>;
        };

        const opened = typeof internal._openTextDocument === 'function'
          ? await internal._openTextDocument(path, editor)
          : await ws.openTextDocument(path);

        const languageId = language === 'typescript' ? 'typescript' : language;
        monaco.editor.setModelLanguage(opened, languageId);

        return opened;
      }

      const extByLanguage: Record<string, string> = {
        javascript: 'js',
        typescript: 'tsx',
        css: 'css',
        json: 'json',
      };

      const ext = extByLanguage[language] ?? 'txt';

      const uri = monaco?.Uri?.parse
        ? monaco.Uri.parse(`file:///editorts/${language}/${Date.now()}.${ext}`)
        : undefined;

      const model = monaco.editor.createModel(fallback ?? '', language === 'typescript' ? 'typescript' : language, uri);
      return model;
    };

    // Default file mapping per language
    const defaultPathByLanguage: Record<typeof language, string> = {
      javascript: 'components/selected.js',
      typescript: 'export.tsx',
      css: 'styles.css',
      json: 'page.json',
    };

    const initialPath = defaultPathByLanguage[language];
    const model = await openFile(initialPath, initialValue ?? '');

    editor.setModel(model);

    return {
      getValue: () => model.getValue(),
      setValue: (value: string) => model.setValue(value ?? ''),
      focus: () => editor.focus(),
      dispose: () => {
        editor.dispose();
        if (!ws) {
          model.dispose();
        }
        monacoHost.remove();
      },
    };

  }

  // Built-in code editor setup (optional)

  async function createCodeEditor(
    host: HTMLElement,
    initialValue: string,
    language: 'javascript' | 'typescript' | 'css' | 'json',
    options?: RuntimeCodeEditorOptions
  ): Promise<RuntimeCodeEditor> {
    if (codeEditorProvider === 'modern-monaco') {
      try {
        return await createModernMonacoCodeEditor(host, initialValue, language, options);
      } catch (err: unknown) {
        modernMonacoInitPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Failed to load modern-monaco; falling back to textarea:', message);
        return createTextareaCodeEditor(host, initialValue, options);
      }
    }

    return createTextareaCodeEditor(host, initialValue, options);
  }

  // Code editor instances
  let jsEditor: RuntimeCodeEditor | null = null;
  let cssEditor: RuntimeCodeEditor | null = null;
  let jsonEditor: RuntimeCodeEditor | null = null;

  // Track selected component for JS editor
  let selectedComponentId: string | null = null;

  // Build iframe content with WYSIWYG
  // NOTE: this must be built on-demand so refresh() reflects current Page state.
  const buildIframeContent = () => buildIframeCanvasSrcdocFromPage(page, config.iframe);
  let activePreviewDescriptor: ContentAdapterPreviewDescriptor | null = null;
  let activePreviewPath: string | null = null;
  let lastAppliedPreviewMode: 'page-srcdoc' | 'app-url' | null = null;
  let lastAppliedPreviewUrl: string | null = null;
  let previewSyncVersion = 0;

  const applyIframeSrc = (url: string): void => {
    const target = iframe as HTMLIFrameElement & { src?: string; srcdoc?: string; removeAttribute?: (name: string) => void };
    if (typeof target.removeAttribute === 'function') {
      target.removeAttribute('srcdoc');
    } else {
      target.srcdoc = '';
    }
    target.src = url;
  };

  const applyIframeSrcdoc = (srcdoc: string): void => {
    const target = iframe as HTMLIFrameElement & { src?: string; srcdoc?: string; removeAttribute?: (name: string) => void };
    if (typeof target.removeAttribute === 'function') {
      target.removeAttribute('src');
    } else {
      target.src = '';
    }
    target.srcdoc = srcdoc;
  };

  const resolvePreviewDescriptor = async (): Promise<ContentAdapterPreviewDescriptor | null> => {
    if (typeof contentAdapter.describePreview === 'function') {
      return contentAdapter.describePreview();
    }

    if (typeof contentAdapter.describeWorkspace === 'function') {
      const workspace = await contentAdapter.describeWorkspace();
      return {
        mode: 'page-srcdoc',
        kind: workspace.kind,
        runtime: workspace.runtime,
        routes: [],
      };
    }

    return null;
  };

  const syncIframePreview = async (forceReload: boolean): Promise<void> => {
    const syncVersion = previewSyncVersion + 1;
    previewSyncVersion = syncVersion;

    const descriptor = await resolvePreviewDescriptor();
    if (syncVersion !== previewSyncVersion) return;

    activePreviewDescriptor = descriptor;

    if (descriptor?.mode === 'app-url' && descriptor.baseUrl) {
      const availableRoutePaths = descriptor.routes.map((route) => route.path);
      const nextPath = normalizePreviewPath(activePreviewPath)
        ?? normalizePreviewPath(descriptor.activePath)
        ?? availableRoutePaths[0]
        ?? '/';
      activePreviewPath = nextPath;

      const nextUrl = resolvePreviewUrl(descriptor.baseUrl, nextPath);
      if (forceReload || lastAppliedPreviewMode !== 'app-url' || lastAppliedPreviewUrl !== nextUrl) {
        applyIframeSrc(nextUrl);
        lastAppliedPreviewUrl = nextUrl;
      }
      lastAppliedPreviewMode = 'app-url';
      renderPagesDropdown();
      return;
    }

    activePreviewPath = normalizePreviewPath(descriptor?.activePath);
    const srcdoc = buildIframeContent();
    applyIframeSrcdoc(srcdoc);
    lastAppliedPreviewMode = 'page-srcdoc';
    lastAppliedPreviewUrl = null;
    renderPagesDropdown();
  };

  const navigatePreview = async (path: string | null): Promise<void> => {
    activePreviewPath = normalizePreviewPath(path);
    await syncIframePreview(true);
  };

  // Load content into iframe
  applyIframeSrcdoc(buildIframeContent());
  lastAppliedPreviewMode = 'page-srcdoc';
  void syncIframePreview(true);

  // multipage dropdown is rendered after helpers are defined

  // --- Optional code editors (JS/CSS/JSON) ---
  const shouldEnableFilesViewer = !!filesViewerContainer && config.ui?.editors?.files?.enabled !== false;
  const shouldEnableViewer = !!viewerEditorContainer && config.ui?.editors?.viewer?.enabled !== false;
  const shouldEnableJsEditor = !!jsEditorContainer && config.ui?.editors?.js?.enabled !== false;
  const shouldEnableCssEditor = !!cssEditorContainer && config.ui?.editors?.css?.enabled !== false;
  const shouldEnableJsonEditor = !!jsonEditorContainer && config.ui?.editors?.json?.enabled !== false;
  const shouldEnableJsxEditor = !!jsxEditorContainer && config.ui?.editors?.jsx?.enabled !== false;

  // Render editor panels
  if (shouldEnableFilesViewer && filesViewerContainer) {
    filesViewerContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
          <strong>Workspace Files</strong>
          <button data-editorts-action="refresh-files" type="button">Refresh</button>
        </div>
        <input
          data-editorts-field="files-filter"
          type="text"
          placeholder="Filter files…"
          style="width:100%; padding:0.4rem 0.5rem; border:1px solid rgba(0,0,0,0.12); border-radius:6px;"
        />
        <div data-editorts-field="files-list" style="flex:1 1 auto; min-height:0; overflow:auto; border:1px solid rgba(0,0,0,0.08); border-radius:6px; padding:0.5rem;"></div>
      </div>
    `;
  }

  if (shouldEnableViewer && viewerEditorContainer) {
    viewerEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
          <div style="display:flex; flex-direction:column; gap:0.125rem;">
            <strong>Preview</strong>
            <div data-editorts-field="viewer-path" style="font-size:0.85rem; opacity:0.8;"></div>
          </div>
        </div>
        <div data-editorts-field="viewer-editor" style="flex:1 1 auto; min-height:0;"></div>
      </div>
    `;
  }

  if (shouldEnableJsEditor && jsEditorContainer) {
    jsEditorContainer.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
            <strong>Component JavaScript</strong>
            <button data-editorts-action="save-js" type="button">Save</button>
          </div>
          <div data-editorts-field="js-status" style="font-size:0.85rem; opacity:0.8; flex:0 0 auto;">Select a component to edit its script</div>
          <div style="display:flex; gap:0.75rem; align-items:stretch; flex:1 1 auto; min-height:0;">
            <div data-editorts-field="js-files" style="width:12rem; border:1px solid rgba(0,0,0,0.1); border-radius:6px; padding:0.5rem; overflow:auto; min-height:0;"></div>
            <div style="flex:1; min-width:0; min-height:0;" data-editorts-field="js-editor"></div>
          </div>
        </div>
    `;
  }

  if (shouldEnableCssEditor && cssEditorContainer) {
    cssEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
          <strong>Page CSS</strong>
          <button data-editorts-action="save-css" type="button">Save</button>
        </div>
        <div data-editorts-field="css-editor" style="flex:1 1 auto; min-height:0;"></div>
      </div>
    `;
  }

  if (shouldEnableJsonEditor && jsonEditorContainer) {
    jsonEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
          <div style="font-weight:600;">Page JSON</div>
          <div style="display:flex; gap:0.5rem;">
            <button data-editorts-action="save-json">Apply</button>
          </div>
        </div>
        <div data-editorts-field="json-editor" style="flex:1 1 auto; min-height:0;"></div>
        <div data-editorts-field="json-error" style="color:#ef4444; display:none; flex:0 0 auto;"></div>
      </div>
    `;
  }

  if (shouldEnableJsxEditor && jsxEditorContainer) {
    jsxEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
          <div style="font-weight:600;">JSX</div>
          <div style="display:flex; gap:0.5rem;">
            <button data-editorts-action="export-jsx">Export</button>
          </div>
        </div>
        <div data-editorts-field="jsx-editor" style="flex:1 1 auto; min-height:0;"></div>
        <div data-editorts-field="jsx-error" style="color:#ef4444; display:none; flex:0 0 auto;"></div>
      </div>
    `;
  }


  const listAdapterFiles = async (): Promise<Array<{ path: string; readOnly?: boolean; language?: string }>> => {
    try {
      const files = await contentAdapter.listFiles();
      return files
        .map((file) => ({
          path: file.path,
          readOnly: file.readOnly,
          language: file.language,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('EditorTs: failed to list content adapter files:', message);
      return [];
    }
  };

  const readAdapterFile = async (path: string): Promise<string | null> => {
    try {
      return await contentAdapter.readFile(path);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`EditorTs: failed to read adapter file ${path}:`, message);
      return null;
    }
  };

  let viewerEditor: RuntimeCodeEditor | null = null;
  let viewerPath: string | null = null;

  const setViewerHeader = (path: string | null) => {
    if (!viewerEditorContainer) return;
    const header = viewerEditorContainer.querySelector('[data-editorts-field="viewer-path"]') as HTMLElement | null;
    if (!header) return;

    header.textContent = path ? `Viewing: ${path}` : '';
  };

  const ensureViewerReady = async (path: string, content: string) => {
    if (!shouldEnableViewer || !viewerEditorContainer) return;

    const host = viewerEditorContainer.querySelector('[data-editorts-field="viewer-editor"]') as HTMLElement | null;
    if (!host) return;

    const language =
      path.endsWith('.css') ? 'css' :
        path.endsWith('.json') ? 'json' :
          path.endsWith('.js') ? 'javascript' :
            path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.jsx') ? 'typescript' :
              'typescript';

    if (!viewerEditor) {
      viewerEditor = await createCodeEditor(host, content, language, { readOnly: true });
    } else {
      viewerEditor.setValue(content);
    }

    viewerPath = path;
    setViewerHeader(path);
  };

  let filesListRenderNonce = 0;

  const renderFilesList = async () => {
    if (!shouldEnableFilesViewer || !filesViewerContainer) return;

    const renderNonce = ++filesListRenderNonce;

    const listHost = filesViewerContainer.querySelector('[data-editorts-field="files-list"]') as HTMLElement | null;
    if (!listHost) return;

    const filterInput = filesViewerContainer.querySelector('[data-editorts-field="files-filter"]') as HTMLInputElement | null;
    const rawFilter = filterInput?.value ?? '';
    const filter = rawFilter.trim().toLowerCase();

    listHost.innerHTML = '';

    if (contentAdapter.capabilities?.supportsFileTree === false) {
      listHost.textContent = 'Current content adapter does not expose files';
      return;
    }

    const files = await listAdapterFiles();
    if (renderNonce !== filesListRenderNonce) return;

    const visibleFiles = filter
      ? files.filter((f) => f.path.toLowerCase().includes(filter))
      : files;

    if (visibleFiles.length === 0) {
      listHost.textContent = filter ? 'No matches' : 'No files';
      return;
    }

    visibleFiles.forEach((file) => {
      const path = file.path;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = file.readOnly ? `${path} [read-only]` : path;
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.padding = '0.25rem 0.5rem';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.background = viewerPath === path ? 'rgba(59, 130, 246, 0.10)' : 'transparent';
      btn.style.cursor = 'pointer';

      btn.addEventListener('click', () => {
        // Provide immediate visual feedback.
        viewerPath = path;
        void renderFilesList();

        const targetTab: CodeTab =
          path === 'styles.css' ? 'css'
            : path === 'page.json' ? 'json'
              : path.startsWith('components/') && path.endsWith('.js') ? 'js'
                : 'viewer';

        // Switch tabs immediately so the user sees something happen.
        // Also ensures Monaco hosts are visible before editor creation.
        setCodeTab?.(targetTab);

        // For the viewer tab, show a quick placeholder while loading.
        if (targetTab === 'viewer' && viewerEditorContainer) {
          setViewerHeader(path);
          const host = viewerEditorContainer.querySelector('[data-editorts-field="viewer-editor"]') as HTMLElement | null;
          if (host && !viewerEditor) {
            host.innerHTML = '<pre style="margin:0; opacity:0.8;">Loading…</pre>';
          }
        }

        void (async () => {
          try {
            const value = await readAdapterFile(path);
            if (value === null) {
              console.warn(`EditorTs: adapter did not return content for ${path}`);
              return;
            }

            if (path === 'styles.css') {
              await ensureCssEditorReady();
              cssEditor?.setValue(value);
              cssEditor?.focus();
              return;
            }

            if (path === 'page.json') {
              await ensureJsonEditorReady();
              jsonEditor?.setValue(value);
              jsonEditor?.focus();
              return;
            }

            if (path.startsWith('components/') && path.endsWith('.js')) {
              const id = path.slice('components/'.length, -3);
              const component = page.components.findById(id);
              if (component) {
                iframe.contentWindow?.postMessage({ type: 'editorts:selectComponent', id }, '*');
                layerManager?.setSelected(id);
              }

              await ensureJsEditorReadyFor(component);
              jsEditor?.setValue(value);
              jsEditor?.focus();
              return;
            }

            await ensureViewerReady(path, value);
            viewerEditor?.focus();
            void renderFilesList();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`Failed to open adapter file ${path}:`, message);
          }
        })();
      });

      listHost.appendChild(btn);
    });
  };

  async function ensureCssEditorReady() {
    if (!shouldEnableCssEditor || !cssEditorContainer) return;
    const host = cssEditorContainer.querySelector('[data-editorts-field="css-editor"]') as HTMLElement | null;
    if (!host) return;

    if (!cssEditor) {
      cssEditor = await createCodeEditor(host, page.getCSS() ?? '', 'css');
    } else {
      cssEditor.setValue(page.getCSS() ?? '');
    }
  }

  async function ensureJsonEditorReady() {
    if (!shouldEnableJsonEditor || !jsonEditorContainer) return;
    const host = jsonEditorContainer.querySelector('[data-editorts-field="json-editor"]') as HTMLElement | null;
    if (!host) return;

    const nextValue = serializeData();

    if (!jsonEditor) {
      jsonEditor = await createCodeEditor(host, nextValue, 'json');
    } else {
      jsonEditor.setValue(nextValue);
    }
  }

  let jsxEditor: RuntimeCodeEditor | null = null;

  async function ensureJsxEditorReady() {
    if (!shouldEnableJsxEditor || !jsxEditorContainer) return;
    const host = jsxEditorContainer.querySelector('[data-editorts-field="jsx-editor"]') as HTMLElement | null;
    if (!host) return;

    const nextValue = page.components.toJSX({ pretty: true });

    if (!jsxEditor) {
      jsxEditor = await createCodeEditor(host, nextValue, 'typescript');
    } else {
      jsxEditor.setValue(nextValue);
    }
  }

  async function ensureJsEditorReadyFor(component: Component | null) {
    if (!shouldEnableJsEditor || !jsEditorContainer) return;

    const status = jsEditorContainer.querySelector('[data-editorts-field="js-status"]') as HTMLElement | null;
    const host = jsEditorContainer.querySelector('[data-editorts-field="js-editor"]') as HTMLElement | null;
    if (!host) return;

    if (!component) {
      selectedComponentId = null;
      if (status) status.textContent = 'Select a component to edit its script';
      if (!jsEditor) {
        jsEditor = await createCodeEditor(host, '', 'javascript');
      } else {
        jsEditor.setValue('');
      }
      return;
    }

    selectedComponentId = component.attributes?.id ?? null;
    if (status) status.textContent = selectedComponentId ? `Editing: ${selectedComponentId}` : 'Editing: (no id)';

    const nextValue = typeof component.script === 'string' ? component.script : '';

    if (!jsEditor) {
      jsEditor = await createCodeEditor(host, nextValue, 'javascript');
    } else {
      jsEditor.setValue(nextValue);
    }
  }

  function renderJsFileList() {
    if (!shouldEnableJsEditor || !jsEditorContainer) return;

    const host = jsEditorContainer.querySelector('[data-editorts-field="js-files"]') as HTMLElement | null;
    if (!host) return;

    host.innerHTML = '';

    const collectIds = (components: Component[], out: string[]) => {
      components.forEach((component) => {
        const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
        if (id) out.push(id);
        if (component.components && component.components.length > 0) {
          collectIds(component.components, out);
        }
      });
    };

    const ids: string[] = [];
    collectIds(page.components.getAll(), ids);
    const uniqueIds = Array.from(new Set(ids));

    if (uniqueIds.length === 0) {
      host.textContent = 'No components with ids';
      return;
    }

    uniqueIds.forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = id;
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.padding = '0.25rem 0.5rem';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.background = id === selectedComponentId ? 'rgba(16,185,129,0.15)' : 'transparent';
      btn.style.cursor = 'pointer';

      btn.addEventListener('click', () => {
        const component = page.components.findById(id);
        if (!component) return;

        // Keep canvas + layers selection in sync
        iframe.contentWindow?.postMessage({ type: 'editorts:selectComponent', id }, '*');
        layerManager?.setSelected(id);

        void ensureJsEditorReadyFor(component).then(() => {
          renderJsFileList();
          jsEditor?.focus();
        });

        if (workspace) {
          const filename = `components/${id}.js`;
          void workspace.openTextDocument(filename, typeof component.script === 'string' ? component.script : '').then((model) => {
            jsEditor?.setValue(model.getValue());
          });
        }
      });

      host.appendChild(btn);
    });
  }

  // Wire Save/Export buttons
  if (shouldEnableFilesViewer && filesViewerContainer) {
    const btn = filesViewerContainer.querySelector('[data-editorts-action="refresh-files"]') as HTMLButtonElement | null;
    addManagedEventListener(btn, 'click', async () => {
      if (workspaceEnabled && !workspace) {
        try {
          const mod = await import('modern-monaco');
          await ensureWorkspace(mod);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('Failed to load modern-monaco workspace:', message);
        }
      }

      await syncWorkspaceFiles();
      await renderFilesList();
    });

    const filterInput = filesViewerContainer.querySelector('[data-editorts-field="files-filter"]') as HTMLInputElement | null;
    addManagedEventListener(filterInput, 'input', () => {
      void renderFilesList();
    });
  }
  if (shouldEnableJsxEditor && jsxEditorContainer) {
    const btn = jsxEditorContainer.querySelector('[data-editorts-action="export-jsx"]') as HTMLButtonElement | null;
    addManagedEventListener(btn, 'click', async () => {
      await ensureJsxEditorReady();
      jsxEditor?.focus();
    });
  }

  if (shouldEnableCssEditor && cssEditorContainer) {
    const btn = cssEditorContainer.querySelector('[data-editorts-action="save-css"]') as HTMLButtonElement | null;
    addManagedEventListener(btn, 'click', async () => {
      await ensureCssEditorReady();
      if (!cssEditor) return;

      page.setCSS(cssEditor.getValue());

      if (workspace) {
        await workspace.fs.writeFile('styles.css', cssEditor.getValue(), { isModelContentChange: true });
      }

      await commitSnapshot({ source: 'user', message: 'edit css' });

      refresh();
      refreshLayers();
    });
  }

  if (shouldEnableJsEditor && jsEditorContainer) {
    const btn = jsEditorContainer.querySelector('[data-editorts-action="save-js"]') as HTMLButtonElement | null;
    addManagedEventListener(btn, 'click', async () => {
      if (!selectedComponentId) return;
      const component = page.components.findById(selectedComponentId);
      if (!component) return;

      await ensureJsEditorReadyFor(component);
      if (!jsEditor) return;

      const nextValue = jsEditor.getValue();
      page.components.updateComponent(selectedComponentId, { script: nextValue });

      if (workspace) {
        await workspace.fs.writeFile(`components/${selectedComponentId}.js`, nextValue, { isModelContentChange: true });
      }

      await commitSnapshot({ source: 'user', message: 'edit component script' });

      refresh();
      refreshLayers();
    });
  }

  if (shouldEnableJsonEditor && jsonEditorContainer) {
    const btn = jsonEditorContainer.querySelector('[data-editorts-action="save-json"]') as HTMLButtonElement | null;
    addManagedEventListener(btn, 'click', async () => {
      await ensureJsonEditorReady();
      if (!jsonEditor) return;

      const errorEl = jsonEditorContainer.querySelector('[data-editorts-field="json-error"]') as HTMLElement | null;

      try {
        applyPayload(jsonEditor.getValue());

        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }

        if (workspace) {
          await workspace.fs.writeFile('page.json', jsonEditor.getValue(), { isModelContentChange: true });
        }

        await commitSnapshot({ source: 'user', message: 'edit json' });

        refresh();
        refreshLayers();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        if (errorEl) {
          errorEl.style.display = 'block';
          errorEl.textContent = message;
        }
      }
    });
  }

  // Initial editor content
  void ensureCssEditorReady();
  void ensureJsonEditorReady();
  void ensureJsEditorReadyFor(null);
  void ensureJsxEditorReady();
  renderJsFileList();

  if (workspace) {
    void renderFilesList();
  }

  // Handle messages from iframe
  addManagedEventListener(window, 'message', (event) => {
    if (event.data.type === 'editorts:componentSelected') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update JS editor panel (if enabled)
        void ensureJsEditorReadyFor(component);
        renderJsFileList();

        // Update selected info container if provided
        if (selectedInfoContainer && config.ui?.selectedInfo?.enabled !== false) {
          renderSelectedInfo(component, event.data.id, event.data.tagName);
        }

        // Sync layer panel selection
        if (layerManager) {
          layerManager.setSelected(event.data.id);
        }

        // Emit event
        emit('componentSelect', component);
        if (config.onComponentSelect) {
          config.onComponentSelect(component);
        }
      }
    } else if (event.data.type === 'editorts:getToolbar') {
      // Send toolbar config to iframe
      const component = page.components.findById(event.data.id);
      if (component) {
        const toolbarConfig = page.toolbars.getToolbarForComponent(component);
        iframe.contentWindow?.postMessage({
          type: 'editorts:toolbarConfig',
          config: toolbarConfig,
          elementId: event.data.id
        }, '*');
      }
    } else if (event.data.type === 'editorts:toolbarAction') {
      handleToolbarAction(event.data.action, event.data.elementId);
    } else if (event.data.type === 'editorts:canvasReorder') {
      const draggedId = event.data.draggedId as string;
      const targetId = event.data.targetId as string;

      if (!draggedId || !targetId || draggedId === targetId) return;

      const targetInfo = page.components.getParentAndIndex(targetId);
      if (!targetInfo) return;

      const parentId = typeof event.data.targetParentId === 'string'
        ? event.data.targetParentId
        : targetInfo.parentId;
      const nextIndex = Number.isFinite(event.data.targetIndex)
        ? Number(event.data.targetIndex)
        : targetInfo.index;

      page.components.moveComponent(draggedId, parentId, nextIndex);

      const component = page.components.findById(draggedId);
      if (component) {
        emit('componentReorder', component, parentId, nextIndex);
      }

      void commitSnapshot({ source: 'user', message: 'reorder component' });

      refresh();
      refreshLayers();
    } else if (event.data.type === 'editorts:placeComponent') {
      const targetId = event.data.targetId as string;
      if (!pendingInsertType) return;
      const def = componentRegistry[pendingInsertType];
      if (!def) return;

      const componentToInsert = def.factory();

      // Insert as child of target for now.
      page.components.addChildComponent(targetId, componentToInsert);

      pendingInsertType = null;
      componentPalette?.setSelected(null);
      iframe.contentWindow?.postMessage({ type: 'editorts:placementMode', enabled: false }, '*');

      emit('componentInsert', componentToInsert, targetId);

      void commitSnapshot({ source: 'user', message: 'insert component' });

      refresh();
      refreshLayers();

      // Flash/select the target so placement is obvious.
      iframe.contentWindow?.postMessage({ type: 'editorts:flashSelect', id: targetId }, '*');
    } else if (event.data.type === 'editorts:textEditStart') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('textEditStart', component);
        if (config.onTextEditStart) {
          config.onTextEditStart(component);
        }
      }
    } else if (event.data.type === 'editorts:textUpdate') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update the component's text content
        page.components.updateTextContent(event.data.id, event.data.content);

        emit('textUpdate', component, event.data.content, event.data.originalContent);
        if (config.onTextUpdate) {
          config.onTextUpdate(component, event.data.content, event.data.originalContent);
        }
        refreshLayers();
      }
    } else if (event.data.type === 'editorts:textEditEnd') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('textEditEnd', component, event.data.saved);
        if (config.onTextEditEnd) {
          config.onTextEditEnd(component, event.data.saved);
        }

        if (event.data.saved) {
          void commitSnapshot({ source: 'user', message: 'edit text' });
        }
        refreshLayers();
      }
    } else if (event.data.type === 'editorts:imageEditStart') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('imageEditStart', component, event.data.currentSrc);
        if (config.onImageEditStart) {
          config.onImageEditStart(component, event.data.currentSrc);
        }
      }
    } else if (event.data.type === 'editorts:imageUpdate') {
      const component = page.components.findById(event.data.id);
      if (component) {
        // Update the component's image src
        page.components.updateImageSrc(event.data.id, event.data.src);

        const fileInfo = {
          fileName: event.data.fileName,
          fileType: event.data.fileType,
          fileSize: event.data.fileSize
        };

        emit('imageUpdate', component, event.data.src, event.data.originalSrc, fileInfo);
        if (config.onImageUpdate) {
          config.onImageUpdate(component, event.data.src, event.data.originalSrc, fileInfo);
        }
        refreshLayers();
      }
    } else if (event.data.type === 'editorts:imageEditEnd') {
      const component = page.components.findById(event.data.id);
      if (component) {
        emit('imageEditEnd', component, event.data.saved);
        if (config.onImageEditEnd) {
          config.onImageEditEnd(component, event.data.saved);
        }

        if (event.data.saved) {
          void commitSnapshot({ source: 'user', message: 'edit image' });
        }
        refreshLayers();
      }
    }
  });

  // Inject base styles for selected-info panel (once per document, like LayerManager)
  if (selectedInfoContainer && !document.getElementById('editorts-si-styles')) {
    const siStyle = document.createElement('style');
    siStyle.id = 'editorts-si-styles';
    siStyle.textContent = `
      .editorts-si-root {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
      }
      .editorts-si-identity {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.35rem 0;
      }
      .editorts-si-tag {
        display: inline-block;
        padding: 0.15rem 0.45rem;
        border-radius: 3px;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        background: rgba(59, 130, 246, 0.12);
        color: #3b82f6;
      }
      .editorts-si-id {
        font-size: 0.8rem;
        font-weight: 500;
        color: #374151;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .editorts-si-group {
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 6px;
        overflow: hidden;
      }
      .editorts-si-group[open] > .editorts-si-group-title {
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      }
      .editorts-si-group-title {
        display: block;
        padding: 0.4rem 0.55rem;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #6b7280;
        cursor: pointer;
        user-select: none;
        list-style: none;
        background: rgba(0, 0, 0, 0.02);
      }
      .editorts-si-group-title::-webkit-details-marker { display: none; }
      .editorts-si-group-title::before {
        content: '\\25B8';
        display: inline-block;
        margin-right: 0.35rem;
        font-size: 0.6rem;
        transition: transform 120ms ease;
      }
      .editorts-si-group[open] > .editorts-si-group-title::before {
        transform: rotate(90deg);
      }
      .editorts-si-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: rgba(0, 0, 0, 0.04);
      }
      .editorts-si-field {
        display: flex;
        flex-direction: column;
        gap: 0;
        background: white;
        padding: 0.35rem 0.5rem;
      }
      .editorts-si-field span {
        font-size: 0.65rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #9ca3af;
      }
      .editorts-si-field input {
        border: none;
        background: transparent;
        padding: 0.15rem 0;
        font-size: 0.8rem;
        color: #111827;
        outline: none;
        width: 100%;
      }
      .editorts-si-field input::placeholder {
        color: #d1d5db;
      }
      .editorts-si-field input:focus {
        color: #1d4ed8;
      }
      .editorts-si-actions {
        display: flex;
        gap: 0.35rem;
        align-items: center;
        justify-content: space-between;
      }
      .editorts-si-note {
        font-size: 0.68rem;
        color: #6b7280;
      }
      .editorts-si-btn {
        appearance: none;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        padding: 0.4rem 0.75rem;
        font-size: 0.72rem;
        font-weight: 500;
        cursor: pointer;
        background: white;
        color: #374151;
        transition: background 100ms ease, border-color 100ms ease;
      }
      .editorts-si-btn:hover {
        background: #f9fafb;
        border-color: rgba(0, 0, 0, 0.2);
      }
      .editorts-si-btn-primary {
        background: #2563eb;
        color: white;
        border-color: #2563eb;
      }
      .editorts-si-btn-primary:hover {
        background: #1d4ed8;
        border-color: #1d4ed8;
      }
      .editorts-si-btn-block {
        width: 100%;
        margin-top: 0.35rem;
      }
      .editorts-si-textarea {
        width: 100%;
        min-height: 5rem;
        resize: vertical;
        border: none;
        background: white;
        padding: 0.5rem;
        font-size: 0.82rem;
        color: #111827;
        outline: none;
      }
      .editorts-si-input-full {
        width: 100%;
        border: none;
        background: white;
        padding: 0.4rem 0.5rem;
        font-size: 0.82rem;
        color: #111827;
        outline: none;
      }
    `;
    document.head.appendChild(siStyle);
  }

  function renderSelectedInfo(component: Component, elementId: string, tagName: string) {
    if (!selectedInfoContainer) return;

    const selectedElement = iframe.contentDocument?.getElementById(elementId) as HTMLElement | null;
    const isPlainTextElement = !!selectedElement && selectedElement.childElementCount === 0;

    // For text, only allow editing inner text (not HTML).
    // Also avoid wiping nested markup by requiring a plain-text element.
    const canEditText = isPlainTextElement && tagName?.toLowerCase() !== 'img';

    const canEditImageSrc =
      tagName?.toLowerCase() === 'img' ||
      typeof component.attributes?.src === 'string' ||
      (selectedElement?.tagName.toLowerCase() === 'img');

    selectedInfoContainer.innerHTML = `
      <div class="editorts-si-root">
        <div class="editorts-si-identity">
          <span class="editorts-si-tag">${tagName}</span>
          <span class="editorts-si-id">#${elementId}</span>
        </div>

        <details class="editorts-si-group" open>
          <summary class="editorts-si-group-title">Spacing</summary>
          <div class="editorts-si-grid">
            <label class="editorts-si-field">
              <span>Margin T</span>
              <input data-editorts-style="margin-top" type="text" placeholder="16px" />
            </label>
            <label class="editorts-si-field">
              <span>Margin B</span>
              <input data-editorts-style="margin-bottom" type="text" placeholder="16px" />
            </label>
            <label class="editorts-si-field">
              <span>Padding T</span>
              <input data-editorts-style="padding-top" type="text" placeholder="24px" />
            </label>
            <label class="editorts-si-field">
              <span>Padding B</span>
              <input data-editorts-style="padding-bottom" type="text" placeholder="24px" />
            </label>
          </div>
        </details>

        <details class="editorts-si-group" open>
          <summary class="editorts-si-group-title">Dimensions &amp; Layout</summary>
          <div class="editorts-si-grid">
            <label class="editorts-si-field">
              <span>Width</span>
              <input data-editorts-style="width" type="text" placeholder="100%" />
            </label>
            <label class="editorts-si-field">
              <span>Height</span>
              <input data-editorts-style="height" type="text" placeholder="300px" />
            </label>
            <label class="editorts-si-field">
              <span>Display</span>
              <input data-editorts-style="display" type="text" placeholder="flex" />
            </label>
            <label class="editorts-si-field">
              <span>Gap</span>
              <input data-editorts-style="gap" type="text" placeholder="12px" />
            </label>
          </div>
        </details>

        <details class="editorts-si-group" open>
          <summary class="editorts-si-group-title">Typography</summary>
          <div class="editorts-si-grid">
            <label class="editorts-si-field">
              <span>Color</span>
              <input data-editorts-style="color" type="text" placeholder="#111" />
            </label>
            <label class="editorts-si-field">
              <span>Size</span>
              <input data-editorts-style="font-size" type="text" placeholder="1rem" />
            </label>
            <label class="editorts-si-field">
              <span>Weight</span>
              <input data-editorts-style="font-weight" type="text" placeholder="600" />
            </label>
            <label class="editorts-si-field">
              <span>Align</span>
              <input data-editorts-style="text-align" type="text" placeholder="center" />
            </label>
          </div>
        </details>

        <details class="editorts-si-group">
          <summary class="editorts-si-group-title">Decoration</summary>
          <div class="editorts-si-grid">
            <label class="editorts-si-field">
              <span>Background</span>
              <input data-editorts-style="background-color" type="text" placeholder="#f5f5f5" />
            </label>
            <label class="editorts-si-field">
              <span>Border</span>
              <input data-editorts-style="border" type="text" placeholder="1px solid #ddd" />
            </label>
            <label class="editorts-si-field">
              <span>Radius</span>
              <input data-editorts-style="border-radius" type="text" placeholder="12px" />
            </label>
            <label class="editorts-si-field">
              <span>Transition</span>
              <input data-editorts-style="transition" type="text" placeholder="all 150ms" />
            </label>
          </div>
        </details>

        <div class="editorts-si-actions">
          <span class="editorts-si-note">Style changes apply when you leave a field.</span>
          <button data-editorts-action="clear-style" type="button" class="editorts-si-btn">Clear</button>
        </div>

        ${canEditText ? `
          <details class="editorts-si-group" open>
            <summary class="editorts-si-group-title">Text</summary>
            <textarea data-editorts-field="text-content" class="editorts-si-textarea"></textarea>
            <button data-editorts-action="apply-text" class="editorts-si-btn editorts-si-btn-primary editorts-si-btn-block">Apply text</button>
          </details>
        ` : ''}

        ${canEditImageSrc ? `
          <details class="editorts-si-group" open>
            <summary class="editorts-si-group-title">Image URL</summary>
            <input data-editorts-field="image-src" type="text" class="editorts-si-input-full" />
            <button data-editorts-action="apply-image-src" class="editorts-si-btn editorts-si-btn-primary editorts-si-btn-block">Apply URL</button>
          </details>
        ` : ''}
      </div>
    `;

    // StyleManager stores selector objects as component IDs (without '#').
    // StyleManager.compileToCSS prefixes '#' for selector objects automatically.
    const selector = elementId;

    const styleProps = [
      'margin-top',
      'margin-bottom',
      'padding-top',
      'padding-bottom',
      'width',
      'height',
      'color',
      'background-color',
      'border',
      'border-radius',
      'display',
      'gap',
      'font-size',
      'font-weight',
      'text-align',
      'transition',
    ];

    const populateStyleField = (prop: string) => {
      const input = selectedInfoContainer.querySelector(`[data-editorts-style="${prop}"]`) as HTMLInputElement | null;
      if (!input) return;

      const props = page.styles.getStyleProperties(selector);
      input.value = typeof props?.[prop] === 'string' ? String(props[prop]) : '';
    };

    styleProps.forEach(populateStyleField);

    const collectManagedStyleProperties = (): Record<string, string> => {
      const properties: Record<string, string> = {};

      styleProps.forEach((prop) => {
        const input = selectedInfoContainer.querySelector(`[data-editorts-style="${prop}"]`) as HTMLInputElement | null;
        const value = input?.value.trim();
        if (value) properties[prop] = value;
      });

      return properties;
    };

    const syncSelectedStyleFields = async () => {
      const properties = collectManagedStyleProperties();
      const currentProperties = page.styles.getStyleProperties(selector);
      const managedCurrent = Object.fromEntries(
        styleProps
          .map((prop) => [prop, typeof currentProperties?.[prop] === 'string' ? String(currentProperties[prop]) : ''])
          .filter((entry) => entry[1] !== ''),
      );

      if (JSON.stringify(managedCurrent) === JSON.stringify(properties)) {
        return;
      }

      if (currentProperties) {
        styleProps.forEach((prop) => {
          delete currentProperties[prop];
        });

        Object.assign(currentProperties, properties);

        if (Object.keys(currentProperties).length === 0) {
          page.styles.removeBySelector(selector);
        }
      } else if (Object.keys(properties).length > 0) {
        page.styles.addStyle({
          selectors: [{ name: selector }],
          style: { ...properties },
        });
      }

      page.styles.sync();
      const nextCss = page.getCSS() ?? '';

      if (workspace) {
        await workspace.fs.writeFile('styles.css', nextCss, { isModelContentChange: true });
        await workspace.fs.writeFile('page.json', save(), { isModelContentChange: true });
      }

      const styleEl =
        (iframe.contentDocument?.querySelector('head style[data-editorts="page-css"]') as HTMLStyleElement | null)
        ?? (iframe.contentDocument?.querySelector('head style') as HTMLStyleElement | null);
      if (styleEl) styleEl.textContent = nextCss;

      await commitSnapshot({ source: 'user', message: 'edit style' });

      styleProps.forEach(populateStyleField);

      void ensureCssEditorReady();
      void ensureJsonEditorReady();
      refreshLayers();
    };

    styleProps.forEach((prop) => {
      const input = selectedInfoContainer.querySelector(`[data-editorts-style="${prop}"]`) as HTMLInputElement | null;
      if (!input) return;

      input.addEventListener('blur', () => {
        void syncSelectedStyleFields();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        input.blur();
      });
    });

    const clearStyleButton = selectedInfoContainer.querySelector('[data-editorts-action="clear-style"]') as HTMLButtonElement | null;
    if (clearStyleButton) {
      clearStyleButton.addEventListener('click', async () => {
        page.styles.removeBySelector(selector);

        page.styles.sync();
        const nextCss = page.getCSS() ?? '';

        if (workspace) {
          await workspace.fs.writeFile('styles.css', nextCss, { isModelContentChange: true });
          await workspace.fs.writeFile('page.json', save(), { isModelContentChange: true });
        }

        const styleEl =
          (iframe.contentDocument?.querySelector('head style[data-editorts="page-css"]') as HTMLStyleElement | null)
          ?? (iframe.contentDocument?.querySelector('head style') as HTMLStyleElement | null);
        if (styleEl) styleEl.textContent = nextCss;

        await commitSnapshot({ source: 'user', message: 'clear style' });

        styleProps.forEach((p) => {
          const input = selectedInfoContainer.querySelector(`[data-editorts-style="${p}"]`) as HTMLInputElement | null;
          if (input) input.value = '';
        });

        void ensureCssEditorReady();
        void ensureJsonEditorReady();
        refreshLayers();
      });
    }

    const textArea = selectedInfoContainer.querySelector('[data-editorts-field="text-content"]') as HTMLTextAreaElement | null;
    if (textArea) {
      textArea.value = selectedElement?.textContent ?? '';
    }

    const imageSrcInput = selectedInfoContainer.querySelector('[data-editorts-field="image-src"]') as HTMLInputElement | null;
    if (imageSrcInput) {
      const currentImgEl =
        selectedElement?.tagName.toLowerCase() === 'img'
          ? (selectedElement as HTMLImageElement)
          : (selectedElement?.querySelector('img') as HTMLImageElement | null);

      imageSrcInput.value = currentImgEl?.getAttribute('src') ?? component.attributes?.src ?? '';
    }

    const applyTextButton = selectedInfoContainer.querySelector('[data-editorts-action="apply-text"]') as HTMLButtonElement | null;
    if (applyTextButton && textArea) {
      applyTextButton.addEventListener('click', () => {
        const nextText = textArea.value;

        page.components.updateTextContent(elementId, nextText);
        if (selectedElement) {
          selectedElement.textContent = nextText;
        }
        refreshLayers();
      });
    }

    const applyImageSrcButton = selectedInfoContainer.querySelector('[data-editorts-action="apply-image-src"]') as HTMLButtonElement | null;
    if (applyImageSrcButton && imageSrcInput) {
      applyImageSrcButton.addEventListener('click', () => {
        const nextSrc = imageSrcInput.value;

        page.components.updateImageSrc(elementId, nextSrc);

        if (selectedElement) {
          const imgEl =
            selectedElement.tagName.toLowerCase() === 'img'
              ? (selectedElement as HTMLImageElement)
              : (selectedElement.querySelector('img') as HTMLImageElement | null);

          if (imgEl) {
            imgEl.src = nextSrc;
          }
        }
        refreshLayers();
      });
    }
  }

  // Handle toolbar actions
  function handleToolbarAction(actionId: string, elementId: string) {
    const component = page.components.findById(elementId);
    if (!component) return;

    switch (actionId) {
      case 'edit':
        emit('componentEdit', component);
        if (config.onComponentEdit) {
          config.onComponentEdit(component);
        }
        break;

      case 'editJS':
        emit('componentEditJS', component);
        setView?.('code');
        setCodeTab?.('js');
        void ensureJsEditorReadyFor(component).then(() => jsEditor?.focus());
        break;

      case 'editCSS':
        emit('pageEditCSS', page.getBody());
        setView?.('code');
        setCodeTab?.('css');
        void ensureCssEditorReady().then(() => cssEditor?.focus());
        break;

      case 'editJSON':
        emit('pageEditJSON', page.getBody());
        setView?.('code');
        setCodeTab?.('json');
        void ensureJsonEditorReady().then(() => jsonEditor?.focus());
        break;

      case 'duplicate':
        const clone = JSON.parse(JSON.stringify(component));
        clone.attributes = clone.attributes || {};
        clone.attributes.id = elementId + '-copy-' + Date.now();
        page.components.addComponent(clone);

        emit('componentDuplicate', component, clone);
        if (config.onComponentDuplicate) {
          config.onComponentDuplicate(component, clone);
        }

        void commitSnapshot({ source: 'user', message: 'duplicate component' });

        refresh();
        refreshLayers();
        break;

      case 'delete':
        page.components.removeComponent(elementId);


        emit('componentDelete', component);
        if (config.onComponentDelete) {
          config.onComponentDelete(component);
        }

        void commitSnapshot({ source: 'user', message: 'delete component' });

        // Notify iframe to remove element
        iframe.contentWindow?.postMessage({
          type: 'editorts:toolbarAction',
          action: 'delete',
          elementId: elementId
        }, '*');

        refreshLayers();
        break;
    }
  }

  const setActivePageIndex = (nextIndex: number) => {
    if (!multiPageData) return;

    const boundedIndex = Math.max(0, Math.min(nextIndex, multiPageData.pages.length - 1));
    if (boundedIndex === activePageIndex) return;

    // Persist current page changes before switching
    multiPageData.pages[activePageIndex] = page.toObject();

    activePageIndex = boundedIndex;
    multiPageData.activePageIndex = boundedIndex;

    const loadedPageData = resolvePageData(multiPageData.pages[activePageIndex] ?? multiPageData.pages[0]!);
    const newPage = new Page(loadedPageData);
    Object.assign(page, newPage);

    // Switch to the corresponding per-page history tree when page key is known.
    if (versionControlEnabled && activeStorageKey) {
      void loadVersionState(activeStorageKey, activePageIndex);
    }

    refresh();
  };

  const defaultRenderPagesDropdown = (): void => {
    if (!shouldEnablePages || !pagesContainer) return;

    // If not multipage, show app preview routes when available.
    if (!multiPageData || multiPageData.pages.length <= 1) {
      const previewRoutes = activePreviewDescriptor?.runtime === 'app'
        ? activePreviewDescriptor.routes
        : [];

      if (previewRoutes && previewRoutes.length > 0) {
        const options = previewRoutes
          .map((route) => {
            const selected = route.path === activePreviewPath ? 'selected' : '';
            return `<option value="${route.path}" ${selected}>${route.label}</option>`;
          })
          .join('');

        pagesContainer.innerHTML = `
          <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
            Route
            <select data-editorts-field="preview-route-select" style="width:100%;">
              ${options}
            </select>
          </label>
        `;

        const select = pagesContainer.querySelector('[data-editorts-field="preview-route-select"]') as HTMLSelectElement | null;
        select?.addEventListener('change', () => {
          void navigatePreview(select.value);
        });
        return;
      }

      if (activePreviewDescriptor?.runtime === 'app') {
        pagesContainer.innerHTML = `
          <div style="font-size:0.85rem; opacity:0.75;">
            No app routes were discovered for this workspace.
          </div>
        `;
        return;
      }

      pagesContainer.innerHTML = '';
      return;
    }

    const options = multiPageData.pages
      .map((p, idx) => {
        const label = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : `Page ${idx + 1}`;
        return `<option value="${idx}" ${idx === activePageIndex ? 'selected' : ''}>${label}</option>`;
      })
      .join('');

    pagesContainer.innerHTML = `
      <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
        Page
        <select data-editorts-field="pages-select" style="width:100%;">
          ${options}
        </select>
      </label>
    `;

    const select = pagesContainer.querySelector('[data-editorts-field="pages-select"]') as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      const idx = Number(select.value);
      if (!Number.isFinite(idx)) return;
      setActivePageIndex(idx);
    });
  };

  const renderPagesDropdown = () => {
    if (!shouldEnablePages || !pagesContainer) return;

    if (activePreviewDescriptor?.runtime === 'app' && (!multiPageData || multiPageData.pages.length <= 1)) {
      defaultRenderPagesDropdown();
      return;
    }

    const customRender = config.ui?.pages?.render;
    if (!customRender) {
      defaultRenderPagesDropdown();
      return;
    }

    const pages = multiPageData?.pages ?? [];
    const props: PagesRenderProps = {
      container: pagesContainer,
      pages,
      activePageIndex,
      onSelect: (index) => setActivePageIndex(index),
    };

    customRender(props);
  };

  // Initial render for multipage dropdown (refresh() may not be called yet)
  renderPagesDropdown();

  function refreshLayers() {
    if (layerManager) {
      layerManager.update(page.components.getAll());
    }
  }

  // Refresh iframe and layer panel
  function refresh() {
    if (lastAppliedPreviewMode !== 'app-url') {
      applyIframeSrcdoc(buildIframeContent());
      lastAppliedPreviewMode = 'page-srcdoc';
      lastAppliedPreviewUrl = null;
    }
    void syncIframePreview(false);
    void syncWorkspaceFiles();

    refreshLayers();

    renderStats();
    renderPagesDropdown();
    void ensureCssEditorReady();
    void ensureJsonEditorReady();
    void ensureJsxEditorReady();
    void renderFilesList();

    const selected = selectedComponentId ? page.components.findById(selectedComponentId) : null;
    void ensureJsEditorReadyFor(selected);
    renderJsFileList();
  }

  // Version control (snapshot tree) persisted separately via StorageManager.
  const versionControlEnabled = config.versionControl?.enabled !== false;
  const versionControlMaxSnapshots = config.versionControl?.maxSnapshots;

  const autoSaveConfig = config.autoSave;
  const autoSaveEnabled = autoSaveConfig?.enabled === true;
  const autoSaveEveryEdits = Math.max(1, autoSaveConfig?.everyEdits ?? 1);
  const autoSaveUiEnabled = autoSaveEnabled && config.ui?.autoSave?.enabled !== false;

  let autoSaveEditCount = 0;
  let autoSaveInFlight: Promise<void> | null = null;

  const updateAutoSaveProgress = (count: number) => {
    if (!autoSaveUiEnabled || !autoSaveProgressBar) return;

    const progress = Math.min(1, Math.max(0, count / autoSaveEveryEdits));
    autoSaveProgressBar.style.width = `${Math.round(progress * 100)}%`;
    autoSaveProgressBar.style.opacity = progress > 0 ? '0.6' : '0';
  };

  let versionStorageKey: string | null = null;
  let versionControl: VersionControl | null = null;
  let activeStorageKey: string | null = null;

  if (commandPaletteEnabled) {
    const componentEntries: CommandPaletteEntry[] = Object.values(componentRegistry).map((def) => ({
      kind: 'component',
      type: def.type,
      label: def.label ?? def.type,
      action: () => undefined,
    }));

    const customEntries: CommandPaletteEntry[] = (commandPaletteConfig?.items ?? []).map((item) => ({
      kind: item.type ?? 'command',
      label: item.title,
      action: item.action,
    }));

    commandPaletteEntries = [...componentEntries, ...customEntries];

    const renderHint = (text: string) => {
      if (commandPaletteHint) {
        commandPaletteHint.textContent = text;
      }
    };

    const addComponentFromPalette = async (type: string) => {
      const def = componentRegistry[type];
      if (!def) return;

      const newComponent = def.factory();
      const targetId = selectedComponentId ?? null;

      if (targetId) {
        page.components.addChildComponent(targetId, newComponent);
      } else {
        page.components.addComponent(newComponent);
      }

      emit('componentInsert', newComponent, targetId);

      await commitSnapshot({ source: 'user', message: 'command palette add' });
      refresh();
      refreshLayers();
      closeCommandPalette();
    };

    const updateCommandPaletteActiveStyles = () => {
      if (!commandPaletteResults) return;
      const buttons = Array.from(
        commandPaletteResults.querySelectorAll('button[data-editorts-palette-kind]')
      ) as HTMLButtonElement[];

      buttons.forEach((button, index) => {
        const isActive = index === commandPaletteActiveIndex;
        button.dataset.editortsPaletteActive = isActive ? 'true' : 'false';
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.style.background = isActive ? 'rgba(79,70,229,0.12)' : 'white';
        if (isActive) {
          commandPaletteInput?.setAttribute('aria-activedescendant', button.id);
        }
      });
    };

    renderCommandPaletteResults = () => {
      if (!commandPaletteResults || isRenderingCommandPalette) return;
      isRenderingCommandPalette = true;

      const query = commandPaletteInput?.value.trim().toLowerCase() ?? '';

      const entries = commandPaletteEntries.filter((entry) => entry.label.toLowerCase().includes(query)
        || (entry.type ? entry.type.includes(query) : false));

      commandPaletteResults.innerHTML = '';
      commandPaletteResults.setAttribute('role', 'listbox');

      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No matching components';
        empty.style.opacity = '0.6';
        commandPaletteResults.appendChild(empty);
        renderHint('No matches');
        isRenderingCommandPalette = false;
        return;
      }

      commandPaletteActiveIndex = Math.max(0, Math.min(commandPaletteActiveIndex, entries.length - 1));
      renderHint('Press Enter to add to selected or to the page root.');

      entries.forEach((entry, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `editorts-palette-option-${index}`;
        button.dataset.editortsPaletteKind = entry.kind;
        button.dataset.editortsPaletteLabel = entry.label;
        if (entry.type) {
          button.dataset.editortsPaletteType = entry.type;
        }
        button.tabIndex = 0;
        button.setAttribute('role', 'option');
        button.style.display = 'flex';
        button.style.width = '100%';
        button.style.justifyContent = 'space-between';
        button.style.alignItems = 'center';
        button.style.padding = '0.4rem 0.5rem';
        button.style.border = '1px solid rgba(0,0,0,0.08)';
        button.style.borderRadius = '6px';
        button.style.cursor = 'pointer';
        button.style.marginBottom = '0.35rem';

        const label = document.createElement('span');
        label.textContent = entry.label;

        const tag = document.createElement('span');
        tag.textContent = entry.type ?? entry.kind;
        tag.style.fontSize = '0.75rem';
        tag.style.opacity = '0.6';

        button.appendChild(label);
        button.appendChild(tag);

        button.addEventListener('click', () => {
          if (entry.kind === 'component' && entry.type) {
            void addComponentFromPalette(entry.type);
            return;
          }

          const result = entry.action();
          if (result && typeof (result as Promise<void>).then === 'function') {
            void (result as Promise<void>);
          }
          closeCommandPalette();
        });

        button.addEventListener('focus', () => {
          commandPaletteActiveIndex = index;
          updateCommandPaletteActiveStyles();
        });

        button.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            commandPaletteActiveIndex = Math.min(commandPaletteActiveIndex + 1, entries.length - 1);
            updateCommandPaletteActiveStyles();
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            commandPaletteActiveIndex = Math.max(commandPaletteActiveIndex - 1, 0);
            updateCommandPaletteActiveStyles();
            return;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            if (entry.kind === 'component' && entry.type) {
              void addComponentFromPalette(entry.type);
              return;
            }

            const result = entry.action();
            if (result && typeof (result as Promise<void>).then === 'function') {
              void (result as Promise<void>);
            }
            closeCommandPalette();
          }
        });

        commandPaletteResults.appendChild(button);
      });

      updateCommandPaletteActiveStyles();
      isRenderingCommandPalette = false;
    };

    openCommandPalette = () => {
      if (!commandPaletteContainer) return;
      isCommandPaletteOpen = true;
      commandPaletteActiveIndex = 0;
      commandPaletteContainer.style.display = 'flex';
      commandPaletteContainer.setAttribute('aria-hidden', 'false');
      commandPaletteInput?.focus();
      renderCommandPaletteResults();
    };

    closeCommandPalette = () => {
      if (!commandPaletteContainer) return;
      isCommandPaletteOpen = false;
      commandPaletteContainer.style.display = 'none';
      commandPaletteContainer.setAttribute('aria-hidden', 'true');
    };

    if (commandPaletteContainer) {
      commandPaletteContainer.style.display = 'none';
      commandPaletteContainer.setAttribute('aria-hidden', 'true');
    }

    addManagedEventListener(commandPaletteInput, 'input', () => {
      commandPaletteActiveIndex = 0;
      renderCommandPaletteResults();
    });

    const selectEntry = (entry: CommandPaletteEntry | undefined) => {
      if (!entry) return;

      if (entry.kind === 'component' && entry.type) {
        void addComponentFromPalette(entry.type);
        return;
      }

      const result = entry.action();
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>);
      }
      closeCommandPalette();
    };

    addManagedEventListener(commandPaletteInput, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        commandPaletteActiveIndex = Math.min(commandPaletteActiveIndex + 1, commandPaletteEntries.length - 1);
        renderCommandPaletteResults();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        commandPaletteActiveIndex = Math.max(commandPaletteActiveIndex - 1, 0);
        renderCommandPaletteResults();
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        const options = commandPaletteResults?.querySelectorAll('[data-editorts-palette-kind]') ?? [];
        const node = options.item(commandPaletteActiveIndex) as HTMLElement | null;
        node?.focus();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const entry = commandPaletteEntries[commandPaletteActiveIndex];
        selectEntry(entry);
      }
    });

    addManagedEventListener(commandPaletteResults, 'keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        commandPaletteActiveIndex = Math.min(commandPaletteActiveIndex + 1, commandPaletteEntries.length - 1);
        renderCommandPaletteResults();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        commandPaletteActiveIndex = Math.max(commandPaletteActiveIndex - 1, 0);
        renderCommandPaletteResults();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const entry = commandPaletteEntries[commandPaletteActiveIndex];
        selectEntry(entry);
      }
    });

    addManagedEventListener(commandPaletteContainer, 'click', (event) => {
      if (event.target === commandPaletteContainer) {
        closeCommandPalette();
      }
    });

    addManagedEventListener(commandPaletteClose, 'click', () => closeCommandPalette());

    addManagedEventListener(document, 'keydown', (event) => {
      if (isCommandPaletteOpen && event.key === 'Escape') {
        event.preventDefault();
        closeCommandPalette();
      }
    });
  }

  const shortcutContext: ShortcutContext = {
    openCommandPalette: () => {
      if (!commandPaletteEnabled) return;
      openCommandPalette();
    },
    undo: async () => {
      if (versionControl && versionControl.canUndo()) {
        const snapshot = versionControl.undo();
        if (!snapshot) return;
        await checkoutSnapshot(snapshot);
        await persistVersionState();
        return;
      }

      (document.getElementById('history-undo') as HTMLButtonElement | null)?.click();
    },
    redo: async () => {
      if (versionControl && versionControl.canRedo()) {
        const snapshot = versionControl.redo();
        if (!snapshot) return;
        await checkoutSnapshot(snapshot);
        await persistVersionState();
        return;
      }

      (document.getElementById('history-redo') as HTMLButtonElement | null)?.click();
    },
    deleteSelected: async () => {
      const targetId = selectedComponentId ?? page.components.getAll()[0]?.attributes?.id ?? null;
      if (!targetId) return;
      handleToolbarAction('delete', targetId);
    },
  };

  const editorShortcuts = [
    ...createEditorShortcuts({
      undo: shortcutContext.undo,
      redo: shortcutContext.redo,
      deleteSelected: shortcutContext.deleteSelected,
    }),
    ...(config.shortcuts ?? []),
  ];

  const paletteShortcuts = commandPaletteEnabled
    ? [
      ...createCommandPaletteShortcuts({ openCommandPalette: shortcutContext.openCommandPalette }),
      ...(config.ui?.commandPalette?.shortcuts ?? []),
    ]
    : [];

  const keyboardShortcuts = new KeyboardShortcuts({
    shortcuts: [...paletteShortcuts, ...editorShortcuts],
    modKey: config.shortcutConfig?.modKey ?? 'ctrl',
    shouldIgnore: (event) => {
      if (isCommandPaletteOpen) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  });
  keyboardShortcuts.bind(document);
  if (iframe.contentDocument) {
    keyboardShortcuts.bind(iframe.contentDocument);
  }
  addManagedEventListener(iframe, 'load', () => {
    if (iframe.contentDocument) {
      keyboardShortcuts.bind(iframe.contentDocument);
    }
  });

  const captureSnapshot = (): PageData => {
    // Page.toObject() returns a live reference; clone to keep history stable.
    return JSON.parse(JSON.stringify(page.toObject())) as PageData;
  };

  if (versionControlEnabled) {
    versionControl = new VersionControl({ maxSnapshots: versionControlMaxSnapshots });
    versionControl.init(captureSnapshot(), { source: 'system', message: 'init' });
  }

  const getHistoryKey = (pageKey: string, pageIndex: number) => {
    return `history:${pageKey}:${pageIndex}`;
  };

  // Note: version history is persisted separately via StorageManager at
  // `history:<pageKey>:<pageIndex>`, never inside the PageData JSON.
  const serializeVersionState = (): string | null => {
    if (!versionControl) return null;
    return JSON.stringify(versionControl.getState());
  };

  const loadVersionState = async (pageKey: string, pageIndex: number) => {
    if (!versionControlEnabled) return;

    versionStorageKey = getHistoryKey(pageKey, pageIndex);
    const raw = await storage.loadPage(versionStorageKey);

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
          versionControl = VersionControl.fromState(parsed as unknown as import('./VersionControl').VersionControlState, {
            maxSnapshots: versionControlMaxSnapshots,
          });
          return;
        }
      } catch {
        // ignore
      }
    }

    versionControl = new VersionControl({ maxSnapshots: versionControlMaxSnapshots });
    versionControl.init(captureSnapshot(), { source: 'system', message: 'init' });

    await storage.savePage(versionStorageKey, JSON.stringify(versionControl.getState()));
  };

  const persistVersionState = async () => {
    if (!versionControlEnabled) return;
    if (!versionControl || !versionStorageKey) return;
    await storage.savePage(versionStorageKey, JSON.stringify(versionControl.getState()));
  };

  const triggerAutoSave = async () => {
    if (!autoSaveEnabled) return;

    autoSaveEditCount += 1;
    updateAutoSaveProgress(autoSaveEditCount);

    if (autoSaveEditCount < autoSaveEveryEdits) return;

    autoSaveEditCount = 0;
    updateAutoSaveProgress(autoSaveEveryEdits);

    const key = autoSaveConfig?.key ?? activeStorageKey;
    if (!key) return;

    if (!autoSaveInFlight) {
      autoSaveInFlight = saveTo(key)
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('EditorTs: auto-save failed:', message);
        })
        .finally(() => {
          autoSaveInFlight = null;
        });
    }

    await autoSaveInFlight;

    setTimeout(() => updateAutoSaveProgress(0), 150);
  };

  function buildCurrentContentPayload(): PageData | MultiPageData {
    return JSON.parse(serializeData()) as PageData | MultiPageData;
  }

  async function persistContentAdapter(): Promise<void> {
    try {
      await contentAdapter.save({ data: buildCurrentContentPayload() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('EditorTs: content adapter save failed:', message);
    }
  }

  const commitSnapshot = async (meta?: { source?: 'user' | 'ai' | 'system'; message?: string }) => {
    await triggerAutoSave();

    await persistContentAdapter();

    if (!versionControlEnabled || !versionControl) return;

    versionControl.commit(captureSnapshot(), meta);

    // Persist only when a storage key is known.
    await persistVersionState();
  };

  async function loadFromContentAdapter(): Promise<boolean> {
    try {
      const snapshot = await contentAdapter.load();
      applyPayload(snapshot.data);
      refresh();
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('EditorTs: content adapter load failed:', message);
      return false;
    }
  }

  if (config.initialStorageKey) {
    void loadFrom(config.initialStorageKey);
  } else if (shouldHydrateFromContentAdapter) {
    void loadFromContentAdapter();
  }

  const checkoutSnapshot = async (snapshot: PageData) => {
    const toolbarRuntimeConfig = page.toolbars.exportConfig();

    // Never mutate the snapshot stored in version control.
    const nextSnapshot = JSON.parse(JSON.stringify(snapshot)) as PageData;

    const newPage = new Page(resolvePageData(nextSnapshot));
    Object.assign(page, newPage);
    page.toolbars.importConfig(toolbarRuntimeConfig);

    refresh();
  };

  function serializeData(): string {
    if (!multiPageData) {
      return page.toJSON();
    }

    multiPageData.pages[activePageIndex] = page.toObject();
    return JSON.stringify(multiPageData, null, 2);
  }

  // Save page data (returns JSON string)
  function save(): string {
    return serializeData();
  }

  // Save page to storage
  async function saveTo(key: string): Promise<void> {
    const data = serializeData();
    await storage.savePage(key, data);
    await persistContentAdapter();

    activeStorageKey = key;

    // Persist history alongside the page data.
    if (versionControlEnabled) {
      // Default to active page index for multipage.
      const pageIndex = multiPageData ? activePageIndex : 0;
      if (!versionStorageKey) {
        await loadVersionState(key, pageIndex);
      }
      await persistVersionState();
    }

    emit('pageSaved', key);
  }

  // Load page from storage
  async function loadFrom(key: string): Promise<boolean> {
    activeStorageKey = key;
    const data = await storage.loadPage(key);
    if (!data) return false;

    applyPayload(data);
    await persistContentAdapter();

    if (versionControlEnabled) {
      const pageIndex = multiPageData ? activePageIndex : 0;
      await loadVersionState(key, pageIndex);
    }

    refresh();
    emit('pageLoaded', key);
    return true;
  }

  // Destroy editor
  function destroy() {
    lifecycleAbortController.abort();
    applyIframeSrcdoc('');
    lastAppliedPreviewMode = null;
    lastAppliedPreviewUrl = null;
    activePreviewDescriptor = null;
    activePreviewPath = null;

    jsEditor?.dispose();
    cssEditor?.dispose();
    jsonEditor?.dispose();
    jsxEditor?.dispose();

    keyboardShortcuts.unbind();
    void ai?.close();

    if (sidebarContainer) sidebarContainer.innerHTML = '';
    if (statsContainer) statsContainer.innerHTML = '';
    if (selectedInfoContainer) selectedInfoContainer.innerHTML = '';
    if (jsEditorContainer) jsEditorContainer.innerHTML = '';
    if (cssEditorContainer) cssEditorContainer.innerHTML = '';
    if (jsonEditorContainer) jsonEditorContainer.innerHTML = '';
    if (jsxEditorContainer) jsxEditorContainer.innerHTML = '';
    if (layerManager) layerManager.destroy();
    componentPalette?.destroy();

    (Object.keys(eventListeners) as EditorTsEventName[]).forEach((key) => {
      eventListeners[key] = [];
    });
  }

  // Return EditorTsEditor instance
  return {
    page,
    storage,
    content: {
      adapter: contentAdapter,
      load: async () => {
        await loadFromContentAdapter();
      },
      save: persistContentAdapter,
      describeWorkspace: async () => {
        if (typeof contentAdapter.describeWorkspace !== 'function') {
          return null;
        }
        return contentAdapter.describeWorkspace();
      },
      buildAiWorkspace: async () => {
        if (typeof contentAdapter.buildAiWorkspace !== 'function') {
          return null;
        }
        return contentAdapter.buildAiWorkspace();
      },
      describePreview: async () => {
        return resolvePreviewDescriptor();
      },
    },
    preview: {
      describe: async () => resolvePreviewDescriptor(),
      currentPath: () => activePreviewPath,
      navigate: async (path: string | null) => {
        await navigatePreview(path);
      },
      refresh: async () => {
        await syncIframePreview(true);
      },
    },
    ai,
    versionControl: versionControlEnabled ? {
      enabled: true,
      canUndo: () => !!versionControl && versionControl.canUndo(),
      canRedo: () => !!versionControl && versionControl.canRedo(),
      undo: async () => {
        if (!versionControl) return false;
        const snapshot = versionControl.undo();
        if (!snapshot) return false;
        await checkoutSnapshot(snapshot);
        await persistVersionState();
        return true;
      },
      redo: async () => {
        if (!versionControl) return false;
        const snapshot = versionControl.redo();
        if (!snapshot) return false;
        await checkoutSnapshot(snapshot);
        await persistVersionState();
        return true;
      },
      commit: async (meta) => {
        await commitSnapshot(meta);
      },
    } : undefined,
    components: componentRegistry,
    on,
    off,
    refresh,
    save,
    saveTo,
    loadFrom,
    destroy,
    vimMode,
    elements: {
      iframe,
      sidebar: sidebarContainer || undefined,
      stats: statsContainer || undefined,
      selectedInfo: selectedInfoContainer || undefined,
    }
  };
}
