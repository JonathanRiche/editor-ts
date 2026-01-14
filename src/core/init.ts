/**
 * EditorTs Editor Initialization
 * Users control the layout - init() just populates their containers
 */

import { Page } from './Page';
import { LayerManager } from './LayerManager';
import { ComponentPalette } from './ComponentPalette';
import { StorageManager } from './StorageManager';
import { buildIframeCanvasSrcdocFromPage } from './iframeCanvas';
import { defaultComponentRegistry, mergeCustomComponentRegistry } from './CustomComponentRegistry';
import { applyAiReplacementsToPage, requestAiReplacements } from './aiChat';
import { VersionControl } from './VersionControl';
import type { InitConfig, EditorTsEditor, Component, PageData, MultiPageData, EditorTsAiModule, OpencodeAiProviderConfig, AiProviderMode, EditorTsEventMap, EditorTsEventName } from '../types';

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

  const isMultiPageData = (data: PageData | MultiPageData): data is MultiPageData => {
    return !!data && typeof data === 'object' && Array.isArray((data as MultiPageData).pages);
  };

  const rawData: PageData | MultiPageData =
    typeof config.data === 'string' ? (JSON.parse(config.data) as PageData | MultiPageData) : config.data;
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

  const aiSessionSelect = shouldEnableAiChatUi && aiChatConfig?.sessionSelectId
    ? (document.getElementById(aiChatConfig.sessionSelectId) as HTMLSelectElement | null)
    : null;

  const aiSessionNewButton = shouldEnableAiChatUi && aiChatConfig?.sessionNewButtonId
    ? (document.getElementById(aiChatConfig.sessionNewButtonId) as HTMLButtonElement | null)
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
          return;
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
        editorButton.addEventListener('click', () => setView?.('editor'));
      } else {
        console.warn(`EditorTs: editorButtonId element #${viewTabs.editorButtonId} not found`);
      }
    }

    if (viewTabs.codeButtonId) {
      if (codeButton) {
        codeButton.addEventListener('click', () => setView?.('code'));
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
        btn?.addEventListener('click', () => setCodeTab?.(tab));
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

    aiChatExpandButton.addEventListener('click', () => {
      const root = aiChatRoot ?? (aiChatExpandButton.closest('[data-editorts-ai-chat-root]') as HTMLElement | null);
      const current = root?.dataset.editortsAiChatExpanded === 'true';
      setAiChatExpanded(!current);
    });
  }

  // Optional AI provider module (lazy)
  let ai: EditorTsAiModule | undefined;

  if (config.aiProvider?.provider === 'opencode') {
    const aiConfig: OpencodeAiProviderConfig = config.aiProvider;
    const mode: AiProviderMode = aiConfig.mode ?? 'client';

    const externalClient = aiConfig.client;
    const externalServer = aiConfig.server;

    let server: { url: string; close(): void } | null = null;
    let clientPromise: Promise<import('@opencode-ai/sdk').OpencodeClient> | null = null;

    const loadSdk = async (): Promise<typeof import('@opencode-ai/sdk')> => {
      return import('@opencode-ai/sdk');
    };

     const aiSessionStorageKey = 'ai_sessions';
     const aiSessionCurrentKey = 'ai_session_current';

     let currentSessionId: string | null = null;

      const loadSessionIndex = async (): Promise<{ current: string | null; sessions: Array<{ id: string; title?: string }> }> => {
       const rawSessions = await storage.loadPage(aiSessionStorageKey);
       const rawCurrent = await storage.loadPage(aiSessionCurrentKey);

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

     const saveSessionIndex = async (next: { current: string | null; sessions: Array<{ id: string; title?: string }> }) => {
       await storage.savePage(aiSessionStorageKey, JSON.stringify(next.sessions, null, 2));
       await storage.savePage(aiSessionCurrentKey, JSON.stringify(next.current));
     };

      const appendAiChatLog = (label: string, text: string) => {
        if (!aiChatLog) return;
        aiChatLog.textContent = `${aiChatLog.textContent ?? ''}${label}: ${text}\n\n`;
      };

      const appendAiChatStreamDelta = (delta: string) => {
        if (!aiChatLog) return;
        aiChatLog.textContent = `${aiChatLog.textContent ?? ''}${delta}`;
      };

      const refreshAiSessionSelect = async () => {
        if (!aiSessionSelect || !ai) return;

        if (currentSessionId === null) {
          const index = await loadSessionIndex();
          currentSessionId = index.current;
        }

        const sessions = await ai.sessions.list();
        const current = ai.sessions.current();

        aiSessionSelect.innerHTML = '';

        const addOption = (id: string, label: string) => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = label;
          if (id === current) {
            opt.selected = true;
          }
          aiSessionSelect.appendChild(opt);
        };

        addOption('', '(auto)');

        sessions.forEach((s) => {
          addOption(s.id, s.title ? `${s.title} (${s.id})` : s.id);
        });
      };

      let lastAiReplacements: Array<{ path: string; content: string }> | null = null;

      ai = {
        provider: 'opencode',
        mode,
        getClient: async () => {
        if (!clientPromise) {
          if (externalClient) {
            clientPromise = Promise.resolve(externalClient);
          } else {
            clientPromise = loadSdk().then(async (sdk) => {
              if (mode === 'client') {
                  const baseUrl = aiBaseUrlInput?.value || aiConfig.baseUrl || aiProxiedBaseUrl;
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

              if (typeof sdk.createOpencode !== 'function') {
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
         if (mode === 'client') return aiConfig.baseUrl ?? externalServer?.url ?? null;
         return server?.url ?? externalServer?.url ?? null;
       },
         sessions: {
         current: () => {
           return currentSessionId;
         },
         setCurrent: async (sessionId: string | null) => {
           currentSessionId = sessionId;
           const index = await loadSessionIndex();
           await saveSessionIndex({ ...index, current: sessionId });
         },
         list: async () => {
           const index = await loadSessionIndex();
           return index.sessions;
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
       },
        chat: async (
          prompt: string,
          options?: {
            sessionId?: string;
            stream?: boolean;
            onStream?: (delta: string) => void;
          }
        ) => {
         const client = await ai!.getClient();

         const componentScripts: Record<string, string> = {};
         const collectScripts = (components: Component[]) => {
           components.forEach((component) => {
             const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
             if (id) {
               componentScripts[`components/${id}.js`] = typeof component.script === 'string' ? component.script : '';
             }
             if (component.components && component.components.length > 0) {
               collectScripts(component.components);
             }
           });
         };
         collectScripts(page.components.getAll());

         if (currentSessionId === null) {
           const index = await loadSessionIndex();
           currentSessionId = index.current;
         }

          const sessionId = options?.sessionId ?? currentSessionId;

          const shouldStream = options?.stream ?? aiConfig.stream?.enabled === true;

          const result = await requestAiReplacements({
            client,
            prompt,
            pageJson: save(),
            css: page.getCSS() ?? '',
            componentScripts,
            sessionId: sessionId ?? undefined,
            stream: shouldStream,
            onStream: options?.onStream,
          });

         // Persist session for reuse.
         if (result.sessionId) {
           currentSessionId = result.sessionId;
           const index = await loadSessionIndex();
           const nextSessions = [{ id: result.sessionId }, ...index.sessions.filter((s) => s.id !== result.sessionId)].slice(0, 50);
           await saveSessionIndex({ current: result.sessionId, sessions: nextSessions });
         }

         return result;
       },
      apply: async (replacements) => {
        // Apply potentially many files, then refresh once.
        await applyAiReplacementsToPage({
          page,
          replacements,
          saveJson: async (jsonText: string) => {
            const toolbarRuntimeConfig = page.toolbars.exportConfig();
            const parsed = JSON.parse(jsonText) as PageData | MultiPageData;

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

            if (workspace) {
              await workspace.fs.writeFile('page.json', jsonText, { isModelContentChange: true });
            }
          },
          saveCss: async (cssText: string) => {
            page.styles.setCompiledCSS(cssText);
            if (workspace) {
              await workspace.fs.writeFile('styles.css', cssText, { isModelContentChange: true });
            }
          },
          saveComponentScript: async (id: string, script: string) => {
            page.components.updateComponent(id, { script });
            if (workspace) {
              await workspace.fs.writeFile(`components/${id}.js`, script, { isModelContentChange: true });
            }
          },
        });

        await commitSnapshot({ source: 'ai', message: 'apply ai changes' });

        refresh();
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

        if (aiHealthButton && aiHealthStatus) {
          aiHealthButton.addEventListener('click', async () => {
            if (!ai) {
              aiHealthStatus.textContent = 'AI provider is disabled.';
              return;
            }

            aiHealthStatus.textContent = 'Checking...';

            try {
              const client = await ai.getClient();
              const result = await client.config.get();
              aiHealthStatus.textContent = JSON.stringify(result.data ?? result, null, 2);
            } catch (err: unknown) {
              aiHealthStatus.textContent = err instanceof Error ? err.message : String(err);
            }
          });
        }

        if (aiSessionSelect) {
          void refreshAiSessionSelect();

          aiSessionSelect.addEventListener('change', async () => {
            if (!ai) return;
            const next = aiSessionSelect.value.trim();
            await ai.sessions.setCurrent(next.length ? next : null);
            await refreshAiSessionSelect();
          });
        }

        if (aiSessionNewButton) {
          aiSessionNewButton.addEventListener('click', async () => {
            if (!ai) return;
            const created = await ai.sessions.create('EditorTs Chat');
            await ai.sessions.setCurrent(created.id);
            await refreshAiSessionSelect();
          });
        }

        if (aiChatApplyButton) {
          aiChatApplyButton.addEventListener('click', async () => {
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
            } catch (err: unknown) {
              appendAiChatLog('error', err instanceof Error ? err.message : String(err));
            }
          });
        }

        if (aiChatSendButton && aiChatInput) {
          aiChatSendButton.addEventListener('click', async () => {
            if (!ai) {
              appendAiChatLog('error', 'AI provider is disabled.');
              return;
            }

            const prompt = aiChatInput.value.trim();
            if (!prompt) return;

            appendAiChatLog('user', prompt);
            aiChatSendButton.toggleAttribute('disabled', true);

            try {
              const selectedSessionId = aiSessionSelect?.value?.trim() || undefined;

              let streamedText = '';
              if (streamEnabled && aiChatLog) {
                aiChatLog.textContent = `${aiChatLog.textContent ?? ''}assistant: `;
              }

              const result = await ai.chat(prompt, {
                sessionId: selectedSessionId,
                stream: streamEnabled,
                onStream: streamEnabled
                  ? (delta) => {
                      streamedText += delta;
                      appendAiChatStreamDelta(delta);
                    }
                  : undefined,
              });

              if (streamEnabled && aiChatLog) {
                aiChatLog.textContent = `${aiChatLog.textContent ?? ''}\n\n`;
                if (!streamedText.trim()) {
                  appendAiChatLog('assistant', result.rawText);
                }
              } else {
                appendAiChatLog('assistant', result.rawText);
              }

              if (result.replacements.length === 0) {
                lastAiReplacements = null;
                aiChatApplyButton?.toggleAttribute('disabled', true);
                return;
              }

              if (!autoApply) {
                lastAiReplacements = result.replacements;
                aiChatApplyButton?.toggleAttribute('disabled', false);
                return;
              }

              try {
                await ai.apply(result.replacements);
                appendAiChatLog('apply', `Applied ${result.replacements.length} replacement(s).`);
                lastAiReplacements = null;
                aiChatApplyButton?.toggleAttribute('disabled', true);
              } catch (err: unknown) {
                lastAiReplacements = result.replacements;
                aiChatApplyButton?.toggleAttribute('disabled', false);
                appendAiChatLog('error', err instanceof Error ? err.message : String(err));
              }
            } catch (err: unknown) {
              appendAiChatLog('error', err instanceof Error ? err.message : String(err));
            } finally {
              aiChatSendButton.toggleAttribute('disabled', false);
            }
          });
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
  const buildIframeContent = () => buildIframeCanvasSrcdocFromPage(page);


  // Load content into iframe
  iframe.srcdoc = buildIframeContent();

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


  const listWorkspaceFiles = async (): Promise<string[]> => {
    if (!workspace) return [];

    const out: string[] = [];

    const walk = async (dir: string) => {
      const entries = await workspace!.fs.readDirectory(dir);
      for (const [name, type] of entries) {
        const path = dir ? `${dir}/${name}` : name;
        if (type === 2) {
          await walk(path);
        } else {
          out.push(path);
        }
      }
    };

    await walk('');
    return out.sort();
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

    if (!workspace) {
      listHost.textContent = 'Workspace not enabled';
      return;
    }

    const files = await listWorkspaceFiles();
    if (renderNonce !== filesListRenderNonce) return;

    const visibleFiles = filter
      ? files.filter((p) => p.toLowerCase().includes(filter))
      : files;

    if (visibleFiles.length === 0) {
      listHost.textContent = filter ? 'No matches' : 'No files';
      return;
    }

    visibleFiles.forEach((path) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = path;
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
          if (!workspace) return;

          try {
            const model = await workspace.openTextDocument(path);
            const value = model.getValue();

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
            console.warn(`Failed to open workspace file ${path}:`, message);
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
    btn?.addEventListener('click', async () => {
      if (workspaceEnabled && !workspace) {
        try {
          const mod = await import('modern-monaco');
          await ensureWorkspace(mod);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn('Failed to load modern-monaco workspace:', message);
          return;
        }
      }

      await syncWorkspaceFiles();
      await renderFilesList();
    });

    const filterInput = filesViewerContainer.querySelector('[data-editorts-field="files-filter"]') as HTMLInputElement | null;
    filterInput?.addEventListener('input', () => {
      void renderFilesList();
    });
  }
  if (shouldEnableJsxEditor && jsxEditorContainer) {
    const btn = jsxEditorContainer.querySelector('[data-editorts-action="export-jsx"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      await ensureJsxEditorReady();
      jsxEditor?.focus();
    });
  }

  if (shouldEnableCssEditor && cssEditorContainer) {
    const btn = cssEditorContainer.querySelector('[data-editorts-action="save-css"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      await ensureCssEditorReady();
      if (!cssEditor) return;

      page.setCSS(cssEditor.getValue());

      if (workspace) {
        await workspace.fs.writeFile('styles.css', cssEditor.getValue(), { isModelContentChange: true });
      }

      await commitSnapshot({ source: 'user', message: 'edit css' });

      refresh();
    });
  }

  if (shouldEnableJsEditor && jsEditorContainer) {
    const btn = jsEditorContainer.querySelector('[data-editorts-action="save-js"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
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
    });
  }

  if (shouldEnableJsonEditor && jsonEditorContainer) {
    const btn = jsonEditorContainer.querySelector('[data-editorts-action="save-json"]') as HTMLButtonElement | null;
    btn?.addEventListener('click', async () => {
      await ensureJsonEditorReady();
      if (!jsonEditor) return;

      const errorEl = jsonEditorContainer.querySelector('[data-editorts-field="json-error"]') as HTMLElement | null;

      try {
        const next = JSON.parse(jsonEditor.getValue()) as PageData | MultiPageData;

        const toolbarRuntimeConfig = page.toolbars.exportConfig();

        if (isMultiPageData(next)) {
          if (!next.pages || next.pages.length === 0) throw new Error('MultiPageData.pages cannot be empty');
          multiPageData = next;
          activePageIndex = next.activePageIndex ?? 0;
          const loadedPageData = resolvePageData(next.pages[activePageIndex] ?? next.pages[0]!);
          const newPage = new Page(loadedPageData);
          Object.assign(page, newPage);
        } else {
          multiPageData = null;
          activePageIndex = 0;
          const newPage = new Page(resolvePageData(next as PageData));
          Object.assign(page, newPage);
        }

        // Reapply runtime toolbar configuration
        page.toolbars.importConfig(toolbarRuntimeConfig);

        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }

        if (workspace) {
          await workspace.fs.writeFile('page.json', jsonEditor.getValue(), { isModelContentChange: true });
        }

        await commitSnapshot({ source: 'user', message: 'edit json' });

        refresh();
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
  window.addEventListener('message', (event) => {
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

      page.components.moveComponent(draggedId, targetInfo.parentId, targetInfo.index);

      const component = page.components.findById(draggedId);
      if (component) {
        emit('componentReorder', component, targetInfo.parentId, targetInfo.index);
      }

      void commitSnapshot({ source: 'user', message: 'reorder component' });

      refresh();
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
      }
    }
  });

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
      <div style="display:flex; flex-direction:column; gap:0.75rem;">
        <div>
          <div><strong>ID:</strong> ${elementId}</div>
          <div><strong>Tag:</strong> ${tagName}</div>
        </div>

        <div>
          <div style="font-weight:600; margin-bottom:0.25rem;">Style</div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Margin top
              <input data-editorts-style="margin-top" type="text" placeholder="e.g. 16px" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Margin bottom
              <input data-editorts-style="margin-bottom" type="text" placeholder="e.g. 16px" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Padding top
              <input data-editorts-style="padding-top" type="text" placeholder="e.g. 24px" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Padding bottom
              <input data-editorts-style="padding-bottom" type="text" placeholder="e.g. 24px" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Width
              <input data-editorts-style="width" type="text" placeholder="e.g. 100%" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Height
              <input data-editorts-style="height" type="text" placeholder="e.g. 300px" />
            </label>

            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Color
              <input data-editorts-style="color" type="text" placeholder="e.g. #111" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Background
              <input data-editorts-style="background-color" type="text" placeholder="e.g. #f5f5f5" />
            </label>

            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Border
              <input data-editorts-style="border" type="text" placeholder="e.g. 1px solid #ddd" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Border radius
              <input data-editorts-style="border-radius" type="text" placeholder="e.g. 12px" />
            </label>

            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Display
              <input data-editorts-style="display" type="text" placeholder="e.g. block" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Gap
              <input data-editorts-style="gap" type="text" placeholder="e.g. 12px" />
            </label>

            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Font size
              <input data-editorts-style="font-size" type="text" placeholder="e.g. 18px" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Font weight
              <input data-editorts-style="font-weight" type="text" placeholder="e.g. 600" />
            </label>

            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Text align
              <input data-editorts-style="text-align" type="text" placeholder="e.g. center" />
            </label>
            <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.85rem;">
              Transition
              <input data-editorts-style="transition" type="text" placeholder="e.g. all 150ms ease" />
            </label>
          </div>

          <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
            <button data-editorts-action="apply-style">Apply</button>
            <button data-editorts-action="clear-style" type="button">Clear</button>
          </div>
        </div>

        ${canEditText ? `
          <div>
            <div style="font-weight:600; margin-bottom:0.25rem;">Text</div>
            <textarea data-editorts-field="text-content" style="width:100%; min-height:6rem;"></textarea>
            <button data-editorts-action="apply-text" style="margin-top:0.25rem;">Apply</button>
          </div>
        ` : ''}

        ${canEditImageSrc ? `
          <div>
            <div style="font-weight:600; margin-bottom:0.25rem;">Image URL</div>
            <input data-editorts-field="image-src" type="text" style="width:100%;" />
            <button data-editorts-action="apply-image-src" style="margin-top:0.25rem;">Apply</button>
          </div>
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

    const applyStyleButton = selectedInfoContainer.querySelector('[data-editorts-action="apply-style"]') as HTMLButtonElement | null;
    if (applyStyleButton) {
      applyStyleButton.addEventListener('click', async () => {
        const properties: Record<string, string> = {};
        const readProp = (prop: string) => {
          const input = selectedInfoContainer.querySelector(`[data-editorts-style="${prop}"]`) as HTMLInputElement | null;
          const value = input?.value.trim();
          if (value) properties[prop] = value;
        };

        styleProps.forEach(readProp);

        if (Object.keys(properties).length === 0) return;

        const updated = page.styles.updateStyle(selector, properties);
        if (!updated) {
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

        const styleEl = iframe.contentDocument?.querySelector('head style') as HTMLStyleElement | null;
        if (styleEl) styleEl.textContent = nextCss;

        await commitSnapshot({ source: 'user', message: 'edit style' });

        styleProps.forEach(populateStyleField);

        void ensureCssEditorReady();
        void ensureJsonEditorReady();
      });
    }

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

        const styleEl = iframe.contentDocument?.querySelector('head style') as HTMLStyleElement | null;
        if (styleEl) styleEl.textContent = nextCss;

        await commitSnapshot({ source: 'user', message: 'clear style' });

        styleProps.forEach((p) => {
          const input = selectedInfoContainer.querySelector(`[data-editorts-style="${p}"]`) as HTMLInputElement | null;
          if (input) input.value = '';
        });

        void ensureCssEditorReady();
        void ensureJsonEditorReady();
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

  const renderPagesDropdown = () => {
    if (!shouldEnablePages || !pagesContainer) return;

    // If not multipage, show empty.
    if (!multiPageData || multiPageData.pages.length <= 1) {
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

  // Initial render for multipage dropdown (refresh() may not be called yet)
  renderPagesDropdown();

  // Refresh iframe and layer panel
  function refresh() {
    iframe.srcdoc = buildIframeContent();
    void syncWorkspaceFiles();

    if (layerManager) {
      layerManager.update(page.components.getAll());
    }

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

  // Initialize storage manager
  const storage = new StorageManager(config.storage);

  // Version control (snapshot tree) persisted separately via StorageManager.
  const versionControlEnabled = config.versionControl?.enabled !== false;
  const versionControlMaxSnapshots = config.versionControl?.maxSnapshots;

  let versionStorageKey: string | null = null;
  let versionControl: VersionControl | null = null;
  let activeStorageKey: string | null = null;

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

  const commitSnapshot = async (meta?: { source?: 'user' | 'ai' | 'system'; message?: string }) => {
    if (!versionControlEnabled || !versionControl) return;

    versionControl.commit(captureSnapshot(), meta);

    // Persist only when a storage key is known.
    await persistVersionState();
  };

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

    // Persist history alongside the page data.
    if (versionControlEnabled) {
      activeStorageKey = key;

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
    const data = await storage.loadPage(key);
    if (!data) return false;

    const parsed = JSON.parse(data) as PageData | MultiPageData;

    if (isMultiPageData(parsed)) {
      if (parsed.pages.length === 0) {
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

    if (versionControlEnabled) {
      activeStorageKey = key;
      const pageIndex = multiPageData ? activePageIndex : 0;
      await loadVersionState(key, pageIndex);
    }

    refresh();
    emit('pageLoaded', key);
    return true;
  }

  // Destroy editor
  function destroy() {
    iframe.srcdoc = '';

    jsEditor?.dispose();
    cssEditor?.dispose();
    jsonEditor?.dispose();
    jsxEditor?.dispose();

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
    elements: {
      iframe,
      sidebar: sidebarContainer || undefined,
      stats: statsContainer || undefined,
      selectedInfo: selectedInfoContainer || undefined,
    }
  };
}
}
