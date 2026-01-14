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

  const statsContainer = config.ui?.stats?.containerId
    ? document.getElementById(config.ui.stats.containerId)
    : null;

  const selectedInfoContainer = config.ui?.selectedInfo?.containerId
    ? document.getElementById(config.ui.selectedInfo.containerId)
    : null;

  const layersContainer = config.ui?.layers?.containerId
    ? document.getElementById(config.ui.layers.containerId)
    : null;

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
                const baseUrl = aiConfig.baseUrl;
                if (!baseUrl) {
                  throw new Error("EditorTs: aiProvider.baseUrl is required when mode is 'client'");
                }
                if (typeof sdk.createOpencodeClient !== 'function') {
                  throw new Error('EditorTs: @opencode-ai/sdk missing createOpencodeClient');
                }
                return sdk.createOpencodeClient({ baseUrl });
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
      close: async () => {
        // Only close server that EditorTs started itself.
        if (server) {
          server.close();
        }
        server = null;
      },
    };
  }

  // Built-in code editor setup (optional)
  const codeEditorProvider = config.codeEditor?.provider ?? 'textarea';

  type RuntimeCodeEditor = {
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
    dispose(): void;
  };

  function createTextareaCodeEditor(host: HTMLElement, initialValue: string): RuntimeCodeEditor {
    host.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.value = initialValue;
    textarea.spellcheck = false;
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

  async function loadModernMonaco(): Promise<ModernMonaco> {
    if (!modernMonacoInitPromise) {
      modernMonacoInitPromise = import('modern-monaco').then((mod) => {
        if (typeof mod.init !== 'function') {
          throw new Error('modern-monaco missing init() export');
        }
        return mod.init();
      });
    }

    return modernMonacoInitPromise;
  }

  async function createModernMonacoCodeEditor(
    host: HTMLElement,
    initialValue: string,
    language: 'javascript' | 'typescript' | 'css' | 'json'
  ): Promise<RuntimeCodeEditor> {
    host.innerHTML = '';

    const monacoHost = document.createElement('div');
    monacoHost.style.width = '100%';
    monacoHost.style.height = '100%';
    monacoHost.style.minHeight = '0';
    host.appendChild(monacoHost);

     const mod = await import('modern-monaco');
     const ws = await ensureWorkspace(mod);

     const monaco = await loadModernMonaco();

     const editor = monaco.editor.create(monacoHost, {
       automaticLayout: true,
       minimap: { enabled: false },
     });

     const openFile = async (path: string, fallback: string): Promise<ReturnType<typeof monaco.editor.createModel>> => {
       if (ws) {
         await ws.fs.writeFile(path, fallback, { isModelContentChange: false });
         return ws.openTextDocument(path);
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

  async function createCodeEditor(
    host: HTMLElement,
    initialValue: string,
    language: 'javascript' | 'typescript' | 'css' | 'json'
  ): Promise<RuntimeCodeEditor> {
    if (codeEditorProvider === 'modern-monaco') {
      try {
        return await createModernMonacoCodeEditor(host, initialValue, language);
      } catch (err: unknown) {
        modernMonacoInitPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Failed to load modern-monaco; falling back to textarea:', message);
        return createTextareaCodeEditor(host, initialValue);
      }
    }

    return createTextareaCodeEditor(host, initialValue);
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
        <div data-editorts-field="files-list" style="flex:1 1 auto; min-height:0; overflow:auto; border:1px solid rgba(0,0,0,0.08); border-radius:6px; padding:0.5rem;"></div>
      </div>
    `;
  }

  if (shouldEnableViewer && viewerEditorContainer) {
    viewerEditorContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex:0 0 auto;">
          <strong>Preview</strong>
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
      viewerEditor = await createCodeEditor(host, content, language);

      // Make it read-only.
      const textarea = host.querySelector('textarea');
      if (textarea) {
        textarea.setAttribute('readonly', 'true');
      }
    } else {
      viewerEditor.setValue(content);
    }

    viewerPath = path;
  };

  const renderFilesList = async () => {
    if (!shouldEnableFilesViewer || !filesViewerContainer) return;
    const host = filesViewerContainer.querySelector('[data-editorts-field="files-list"]') as HTMLElement | null;
    if (!host) return;

    host.innerHTML = '';

    if (!workspace) {
      host.textContent = 'Workspace not enabled';
      return;
    }

    const files = await listWorkspaceFiles();

    if (files.length === 0) {
      host.textContent = 'No files';
      return;
    }

    files.forEach((path) => {
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

      host.appendChild(btn);
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

      const nextValue = cssEditor.getValue();
      page.styles.setCompiledCSS(nextValue);

      if (workspace) {
        await workspace.fs.writeFile('styles.css', nextValue, { isModelContentChange: true });
      }

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

        refresh();
        break;

      case 'delete':
        page.components.removeComponent(elementId);

        emit('componentDelete', component);
        if (config.onComponentDelete) {
          config.onComponentDelete(component);
        }

        // Notify iframe to remove element
        iframe.contentWindow?.postMessage({
          type: 'editorts:toolbarAction',
          action: 'delete',
          elementId: elementId
        }, '*');
        break;
    }
  }

  // Refresh iframe and layer panel
  function refresh() {
    iframe.srcdoc = buildIframeContent();
    void syncWorkspaceFiles();

    if (layerManager) {
      layerManager.update(page.components.getAll());
    }

    renderStats();
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
