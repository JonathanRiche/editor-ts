/**
 * Core type definitions for the HTML content editing library
 */

import type { OpencodeClient, OpencodeClientConfig } from '@opencode-ai/sdk/client';
import type { Page } from './core/Page';
import type { StorageAdapter, StorageManager, SqlocalClient } from './core/StorageManager';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[] | Component;
export type JsonObject = { [key: string]: JsonValue };

export interface PageData {
  title: string;
  item_id: number;
  body: PageBody;
}

export interface MultiPageData {
  pages: PageData[];
  activePageIndex?: number;
}

export type PagePayload = PageData | MultiPageData | string;

export type ContentAdapterMode = 'json' | 'filesystem' | (string & {});

export type ContentWorkspaceRuntime = 'page' | 'app';
export type ContentPreviewMode = 'page-srcdoc' | 'app-url';

export type ContentWorkspaceKind =
  | 'json-page'
  | 'static-html'
  | 'jsx-entry'
  | 'vite'
  | 'vite-react'
  | 'vite-solid'
  | 'bun-app'
  | 'filesystem'
  | 'unknown';

export interface ContentAdapterFile {
  /** Project-relative file path (for example: components/header.tsx). */
  path: string;

  /** True when adapter exposes a file but does not allow writes. */
  readOnly?: boolean;

  /** Optional hint for syntax highlighting / editor language mode. */
  language?: string;
}

/**
 * Canonical in-memory editor snapshot exchanged with content adapters.
 *
 * - `data` is the normalized shape consumed by `Page`/`init()`.
 * - `files` is optional metadata for adapters that expose a file tree.
 */
export interface EditorContentSnapshot {
  data: PagePayload;
  files?: ContentAdapterFile[];
}

export interface ContentAdapterCapabilities {
  /** Adapter can persist data changes. */
  writable?: boolean;

  /** Adapter provides a browseable file tree. */
  supportsFileTree?: boolean;

  /** Adapter can represent component JSON as first-class source. */
  supportsComponents?: boolean;

  /** Adapter supports multi-page payloads. */
  supportsMultiPage?: boolean;

  /** Adapter supports raw HTML-source workflows. */
  supportsHtmlSource?: boolean;

  /** Adapter can describe the runtime/workspace shape it is editing. */
  supportsWorkspaceDescription?: boolean;

  /** Adapter can project a custom AI workspace view. */
  supportsCustomAiWorkspace?: boolean;

  /** Adapter can describe how the preview canvas should load. */
  supportsPreviewDescription?: boolean;
}

export interface ContentAdapterWorkspaceDescriptor {
  kind: ContentWorkspaceKind;
  runtime: ContentWorkspaceRuntime;
  entryPaths: string[];
  stylePaths: string[];
  dataPaths: string[];
  scriptPaths: string[];
}

export interface ContentPreviewRoute {
  path: string;
  label: string;
  filePath?: string;
}

export interface ContentAdapterPreviewDescriptor {
  mode: ContentPreviewMode;
  kind: ContentWorkspaceKind;
  runtime: ContentWorkspaceRuntime;
  routes: ContentPreviewRoute[];
  activePath?: string;
  baseUrl?: string;
  entryUrl?: string;
}

export interface ContentAdapterAiWorkspace {
  files: Record<string, string>;
  editablePaths: string[];
  readOnlyPaths: string[];
  mode: 'canonical' | 'files';
  descriptor?: ContentAdapterWorkspaceDescriptor;
}

/**
 * Pluggable content adapter contract.
 *
 * This is separate from `StorageAdapter`:
 * - `StorageAdapter` persists serialized page blobs/assets.
 * - `ContentAdapter` owns how editor content is sourced/saved (JSON model,
 *   project filesystem model, etc).
 */
export interface ContentAdapter {
  /** Unique adapter id (for example: 'json', 'filesystem'). */
  id: string;

  /** Optional standardized mode identifier. */
  mode?: ContentAdapterMode;

  /** Optional capability metadata for UI/runtime behavior decisions. */
  capabilities?: ContentAdapterCapabilities;

  /** Load adapter content into canonical editor snapshot form. */
  load(): Promise<EditorContentSnapshot>;

  /** Save canonical editor snapshot back to adapter source of truth. */
  save(snapshot: EditorContentSnapshot): Promise<void>;

  /** List files available through this adapter. */
  listFiles(): Promise<ContentAdapterFile[]>;

  /** Read file content by path. */
  readFile(path: string): Promise<string | null>;

  /** Write file content by path. */
  writeFile(path: string, content: string): Promise<void>;

  /** Optional adapter-specific runtime/workspace description. */
  describeWorkspace?(): Promise<ContentAdapterWorkspaceDescriptor>;

  /** Optional adapter-specific AI workspace projection. */
  buildAiWorkspace?(): Promise<ContentAdapterAiWorkspace>;

  /** Optional adapter-specific preview descriptor. */
  describePreview?(): Promise<ContentAdapterPreviewDescriptor>;
}

export type AiProviderType = 'disabled' | 'opencode';
export type AiProviderMode = 'client' | 'client+server';

type OpencodeServerLaunchOptions = {
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  timeout?: number;
  config?: OpencodeClientConfig;
};

export interface OpencodeServer {
  url: string;
  close(): void;
}

export interface OpencodeAiProviderConfig {
  provider: 'opencode';

  /**
   * Optional: stream assistant output via server-sent events.
   *
   * When enabled, `editor.ai.chat()` can stream partial output via `options.onStream`.
   */
  stream?: {
    enabled?: boolean;
  };

  /**
   * Optional prompt shaping for session-backed chat requests.
   *
   * When `injectWorkspaceSnapshot` is false, EditorTs sends the user's raw
   * prompt to OpenCode instead of prepending the workspace/system envelope.
   */
  prompt?: {
    injectWorkspaceSnapshot?: boolean;
  };

  /**
   * Optional HTTP Basic Auth for password-protected opencode servers.
   * Username defaults to "opencode" on the server if not provided.
   */
  auth?: {
    username?: string;
    password: string;
  };

  /**
   * Use your own SDK client instance.
   *
   * This is useful when your app already created a client via:
   *   `createOpencodeClient({ baseUrl })`
   * or
   *   `const { client } = await createOpencode()`
   */
  client?: OpencodeClient;

  /**
   * Optional server instance for `getUrl()`.
   * If you pass this, EditorTs will NOT manage its lifecycle.
   */
  server?: OpencodeServer;

  /**
   * - 'client': connect to an existing opencode server via baseUrl
   * - 'client+server': start a server and create a client
   */
  mode?: AiProviderMode;

  // Client-only mode
  baseUrl?: string;
  /**
   * Optional project working directory forwarded to OpenCode client mode.
   *
   * When provided, the SDK sends it as `x-opencode-directory` so server-side
   * session/project operations run against the intended workspace instead of
   * the server process cwd.
   */
  directory?: string | (() => string);

  // Client+server mode
  hostname?: OpencodeServerLaunchOptions['hostname'];
  port?: OpencodeServerLaunchOptions['port'];
  signal?: OpencodeServerLaunchOptions['signal'];
  timeout?: OpencodeServerLaunchOptions['timeout'];

  // opencode config overrides
  config?: OpencodeServerLaunchOptions['config'];

  /**
   * Optional session-list behavior for EditorTs-managed session state.
   *
   * - `storageNamespace` lets apps scope local session persistence to a
   *   connected project or workspace.
   * - `hydrateRemoteList` controls whether EditorTs merges in `session.list()`
   *   results from the server. Disable this when a shared server should not
   *   auto-populate sessions from unrelated working directories.
   */
  sessions?: {
    storageNamespace?: string;
    hydrateRemoteList?: boolean;
    storage?: {
      load(key: string): Promise<string | null>;
      save(key: string, value: string): Promise<void>;
      delete(key: string): Promise<void>;
    };
  };
}

export type AiProviderConfig =
  | { provider?: 'disabled' }
  | OpencodeAiProviderConfig;

export type EditorTsAiChatReplacement = {
  path: string;
  content: string;
};

export type EditorTsAiChatSession = {
  id: string;
  title?: string;
};

export type EditorTsAiChatResult = {
  responseMode: 'raw' | 'replacements';
  replacements: EditorTsAiChatReplacement[];
  rawText: string;
  warnings?: string[];
  skippedPaths: string[];

  /** Session that produced this response (for reuse/persistence). */
  sessionId: string;
};

export interface EditorTsAiModule {
  provider: 'opencode';
  mode: AiProviderMode;

  /** Lazily resolves to an opencode client */
  getClient(): Promise<OpencodeClient>;

  /** Returns current server URL/baseUrl if known */
  getUrl(): string | null;

  /**
   * Request full-file replacements from AI.
   * If a session is selected, prompts reuse that session.
   *
   * If streaming is enabled, `onStream` receives incremental text deltas.
   */
  chat(
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
  ): Promise<EditorTsAiChatResult>;

  /** Apply replacements to the current page */
  apply(replacements: EditorTsAiChatReplacement[]): Promise<void>;

  /** AI session management (persisted via StorageManager) */
  sessions: {
    current(): string | null;
    setCurrent(sessionId: string | null): Promise<void>;
    list(): Promise<EditorTsAiChatSession[]>;
    create(title?: string): Promise<EditorTsAiChatSession>;
    reset(): Promise<void>;
  };

  /** Optional model selector data. */
  models: {
    list(): Promise<Array<{ providerID: string; modelID: string }>>;
  };

  /** Closes embedded server if started */
  close(): Promise<void>;
}

export interface PageBody {
  //NOTE: only need one of these
  html?: string;
  components?: string | Component[]; // JSON string of Component[]
  assets?: Asset[];
  //NOTE: only need one of these
  css?: string;
  styles?: Style[];
}

export type ComponentAttributes = JsonObject & {
  id?: string;
  class?: string;
  src?: string;
};

export interface Component {
  type: string;
  attributes?: ComponentAttributes;
  components?: Component[];
  tagName?: string;
  void?: boolean;
  style?: string;
  script?: string;
  content?: string; // Text content for the component
  [key: string]: JsonValue | undefined;
}

export interface ToolbarConfig {
  enabled: boolean;
  actions: ToolbarAction[];
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  danger?: boolean;
  description?: string;
  handler?: string;
}

export interface Asset {
  type: 'image' | 'video' | 'audio' | 'document';
  src: string;
  unitDim: 'px' | '%' | 'em' | 'rem';
  height: number;
  width: number;
  blinkCDN?: boolean;
}

export interface Style {
  selectors: (string | SelectorObject)[];
  selectorsAdd?: string;
  style: CSSProperties;
  mediaText?: string;
  atRuleType?: 'media' | 'keyframes' | 'supports';
  state?: 'hover' | 'active' | 'focus' | 'visited';
}

export interface SelectorObject {
  name: string;
  active?: boolean;
}

export type CSSProperties = Record<string, string>;

export interface ParsedComponents {
  components: Component[];
}

export interface ComponentQuery {
  id?: string;
  type?: string;
  attributes?: Record<string, JsonValue>;
  tagName?: string;
}

export interface StyleQuery {
  selector?: string;
  mediaText?: string;
  state?: string;
}

export interface UpdateOptions {
  merge?: boolean;
  overwrite?: boolean;
}

export interface ToolbarRule {
  selector: ComponentSelector;
  config: ToolbarConfig;
}

export type ComponentSelector =
  | { id: string }
  | { type: string }
  | { tagName: string }
  | { attributes: Record<string, JsonValue> }
  | { custom: (component: Component) => boolean };

export interface EditorTsSyncMessage {
  type: 'page';
  key?: string;
  payload: PagePayload;
  sentAt: string;
}

export interface EditorTsSyncAck {
  type: 'ack';
  messageId: string;
  receivedAt: string;
}

export type EditorTsSyncEnvelope = EditorTsSyncMessage | EditorTsSyncAck;

export type CustomComponentDefinition = {
  /** Unique type identifier for this component (e.g. 'hero', 'button'). */
  type: string;

  /** Display name for UI (optional). */
  label?: string;

  /** Optional SVG icon (raw <svg>...</svg> markup). */
  iconSvg?: string;

  /**
   * Create a default component JSON object.
   *
   * This should return clean JSON-only component data.
   */
  factory: () => Component;
};

export type CustomComponentRegistry = Record<string, CustomComponentDefinition>;

export type UiRender<Props> = (props: Props) => string | void;

export type PagesRenderProps = {
  container: HTMLElement;
  pages: PageData[];
  activePageIndex: number;
  onSelect: (index: number) => void;
};

export type EditorTsCanvasKind = 'iframe' | 'electrobun-webview';

export interface EditorTsElectrobunWebviewElement extends HTMLElement {
  src?: string;
  html?: string;
  preload?: string;
  hidden?: boolean;
  executeJavascript?(js: string): void;
  syncDimensions?(force?: boolean): void;
  toggleHidden?(value?: boolean): void;
  on?(event: string, listener: (event: CustomEvent<unknown>) => void): void;
  off?(event: string, listener: (event: CustomEvent<unknown>) => void): void;
}

export type EditorTsCanvasElement = HTMLIFrameElement | EditorTsElectrobunWebviewElement;

export interface InitConfig {
  // Required: iframe element ID (user creates this in their HTML)
  iframeId: string;

  /** Optional: override the default iframe canvas with another supported canvas host. */
  canvas?: {
    kind?: EditorTsCanvasKind;
    elementId?: string;
    selector?: string;
    preload?: string;
  };

  /** Optional: iframe head configuration (runtime only). */
  iframe?: IframeHeadConfig;

  /** Optional: preview lifecycle configuration (runtime only). */
  preview?: {
    /**
     * Start with the iframe blank and wait for an explicit `preview.refresh()`
     * call before loading canvas content.
     */
    deferInitialLoad?: boolean;
  };

  // Optional: vim mode defaults to false
  vimMode?: boolean;

  /** Optional: Version control / undo-redo history (runtime config, persisted separately). */
  versionControl?: {
    enabled?: boolean;
    maxSnapshots?: number;
  };

  // Page data payload used for sync bootstrap.
  // Required unless a content adapter is provided.
  data?: PagePayload;

  // Optional: pluggable content source/sink.
  // When omitted, init() uses the built-in JSON content adapter.
  content?: {
    adapter?: ContentAdapter;
  };

  /** Optional: load initial data from storage. */
  initialStorageKey?: string;

  /** Optional: auto-save configuration (runtime only). */
  autoSave?: {
    /** Enable auto-save (default: false). */
    enabled?: boolean;

    /** Save after this many edits (default: 1). */
    everyEdits?: number;

    /** Optional storage key; otherwise uses last saveTo/loadFrom key. */
    key?: string;
  };

  // Optional: toolbar configuration (runtime only)
  toolbars?: ToolbarInitConfig;

  // Optional: custom component registry
  customComponents?: CustomComponentRegistry;

  // Optional: UI container IDs (user controls placement)
  ui?: {
    sidebar?: {
      containerId?: string;  // Where to render sidebar (optional)
      enabled?: boolean;
    };
    stats?: {
      containerId?: string;  // Where to render stats (optional)
      enabled?: boolean;
    };
    selectedInfo?: {
      containerId?: string;  // Where to render selected component info (optional)
      enabled?: boolean;
    };
    layers?: {
      containerId?: string;  // Where to render layer panel (optional)
      enabled?: boolean;
    };

    /** Optional: multipage switcher UI */
    pages?: {
      containerId?: string; // Where to render page dropdown
      enabled?: boolean;
      /** Optional: custom render for page dropdown. */
      render?: UiRender<PagesRenderProps>;
    };

    // Optional: component palette (click-to-place)
    componentPalette?: {
      containerId?: string;
      enabled?: boolean;
    };

    /** Optional: AI chat UI bindings (expand/collapse + controls). */
    aiChat?: {
      /** Root element to receive dataset/class toggles. Defaults to containerId if omitted. */
      rootId?: string;

      /** Expand/collapse button id. */
      expandButtonId?: string;

      /** Optional: set initial expanded state. */
      defaultExpanded?: boolean;

      /** Optional: set a class on the root when expanded. */
      expandedClassName?: string;

      /** Optional: set a class on the root when collapsed. */
      collapsedClassName?: string;

      /** AI chat input textarea id. */
      inputId?: string;

      /** Send button id. */
      sendButtonId?: string;

      /** Optional manual apply button id (fallback when auto-apply fails/disabled). */
      applyButtonId?: string;

      /** Chat log container id. */
      logId?: string;

      /** Optional status indicator container id. */
      statusId?: string;

      /** Optional sessions dropdown id. */
      sessionSelectId?: string;

      /** Optional session history list container id. */
      sessionListId?: string;

      /** Optional model selector dropdown id. */
      modelSelectId?: string;

      /** Optional create-session button id. */
      sessionNewButtonId?: string;

      /** Optional reset-session/chat-state button id. */
      sessionResetButtonId?: string;

      /** Optional health-check button id. */
      healthButtonId?: string;

      /** Optional health-check status container id. */
      healthStatusId?: string;

      /** Optional: baseUrl input id (used only when aiProvider is opencode client mode). */
      baseUrlInputId?: string;

      /** Optional: enable auto-apply for chat results. Default: true. */
      autoApply?: boolean;

      /** Optional: override streaming for this chat UI. */
      stream?: {
        enabled?: boolean;
      };

      /** Optional: external link to OpenCode web chat UI. */
      link?: {
        /** Anchor element id for the external-link button. */
        anchorId?: string;

        /** Optional: override the URL path appended to the base URL. */
        path?: string;

        enabled?: boolean;
      };

      enabled?: boolean;
    };
    /** Optional: auto-save progress UI. */
    autoSave?: {
      /** Progress bar element id. */
      progressBarId?: string;
      enabled?: boolean;
    };

    /** Optional: command palette UI (Ctrl/Cmd+K). */
    commandPalette?: {
      /** Root modal container id. */
      containerId?: string;
      /** Search input id. */
      inputId?: string;
      /** Results list container id. */
      resultsId?: string;
      /** Optional: close button id. */
      closeButtonId?: string;
      /** Optional: hint element id (for status text). */
      hintId?: string;
      /** Optional: custom items to show in the palette. */
      items?: Array<{
        title: string;
        action: () => void | Promise<void>;
        type?: 'component' | 'command';
      }>;
      /** Optional: command palette shortcuts (runtime only). */
      shortcuts?: ShortcutDefinition[];
      /** Enable palette UI (default true when IDs provided). */
      enabled?: boolean;
    };

    editors?: {
      files?: {
        containerId?: string; // Where to render workspace file list
        enabled?: boolean;
      };
      viewer?: {
        containerId?: string; // Where to render read-only file preview
        enabled?: boolean;
      };
      js?: {
        containerId?: string; // Where to render component JS editor
        enabled?: boolean;
      };
      css?: {
        containerId?: string; // Where to render page CSS editor
        enabled?: boolean;
      };
      json?: {
        containerId?: string; // Where to render page JSON editor
        enabled?: boolean;
      };
      jsx?: {
        containerId?: string; // Where to render JSX/TSX view
        enabled?: boolean;
      };
    };

    /**
     * Optional: wire UI tabs to toggle between canvas (iframe) and code panels.
     *
     * This does not create any UI; it only attaches click handlers to your
     * existing buttons and toggles visibility/dataset state.
     */
    viewTabs?: {
      editorButtonId?: string;
      codeButtonId?: string;
      defaultView?: 'editor' | 'code';
    };

    /**
     * Optional: tabs within the code view (JS/CSS/JSON/JSX).
     *
     * This does not create any UI; it only wires existing buttons and toggles
     * visibility of the editor containers.
     */
    codeTabs?: {
      defaultTab?: 'files' | 'viewer' | 'js' | 'css' | 'json' | 'jsx';
      filesButtonId?: string;
      viewerButtonId?: string;
      jsButtonId?: string;
      cssButtonId?: string;
      jsonButtonId?: string;
      jsxButtonId?: string;
    };
  };

  // Optional: built-in code editor provider
  // - 'textarea' (default): lightweight, zero deps
  // - 'modern-monaco': advanced editor (requires optional peer dependency)
  codeEditor?: {
    provider?: 'textarea' | 'modern-monaco';

    /**
     * When using modern-monaco, enable a workspace-backed virtual filesystem.
     *
     * This makes editor models behave like real files and is the basis for
     * later handing a file tree to AI/codegen.
     */
    workspace?: {
      enabled?: boolean;
      name?: string;
    };
  };

  // Optional: AI provider integration
  // - 'disabled' (default): no AI integration
  // - 'opencode': integrates with @opencode-ai/sdk
  aiProvider?: AiProviderConfig;

  /** Optional: keyboard shortcut definitions. */
  shortcuts?: ShortcutDefinition[];

  /** Optional: shortcut behavior configuration. */
  shortcutConfig?: {
    /** Which modifier key "mod" should map to (default: 'ctrl'). */
    modKey?: 'ctrl' | 'meta' | 'alt';
  };

  // Optional: event callbacks
  onComponentSelect?: (component: Component) => void;
  onComponentEdit?: (component: Component) => void;
  onComponentDelete?: (component: Component) => void;
  onComponentDuplicate?: (component: Component, duplicate: Component) => void;

  // Text editing callbacks
  onTextEditStart?: (component: Component) => void;
  onTextUpdate?: (component: Component, newContent: string, originalContent: string) => void;
  onTextEditEnd?: (component: Component, saved: boolean) => void;

  // Image editing callbacks
  onImageEditStart?: (component: Component, currentSrc: string) => void;
  onImageUpdate?: (component: Component, newSrc: string, originalSrc: string, fileInfo: ImageFileInfo) => void;
  onImageEditEnd?: (component: Component, saved: boolean) => void;

  // Optional: storage configuration
  storage?: StorageConfig;
}

export interface IframeHeadConfig {
  /** Raw HTML injected before </head>. */
  headHtml?: string;
  /** External stylesheet URLs injected as <link rel="stylesheet">. */
  stylesheets?: string[];
  /** Additional inline <style> contents injected in <head>. */
  inlineStyles?: string[];
  /** Optional <base href="..."> for resolving relative URLs. */
  baseHref?: string;
}

export type ShortcutDefinition = {
  key: string;
  action: () => void | Promise<void>;
};

export interface ImageFileInfo {
  fileName: string;
  fileType: string;
  fileSize: number;
}

// Storage types (imported from StorageManager)
export interface LocalStorageConfig {
  /**
   * Local storage is the default when `storage` is omitted.
   *
   * This field is optional to allow concise configs like:
   *   { prefix: 'myapp_' }
   */
  type?: 'local';
  prefix?: string;
}

export interface RemoteStorageConfig {
  type: 'remote';
  baseUrl: string;
  imageUploadMethod?: 'form' | 'json';
  headers?: Record<string, string>;
  endpoints?: {
    savePage?: string;
    loadPage?: string;
    deletePage?: string;
    uploadImage?: string;
    deleteImage?: string;
    listPages?: string;
  };
}

export interface SqlocalStorageConfig {
  type: 'sqlocal';
  /** SQLite database file name stored in OPFS (used when `client` is not provided). */
  databaseName?: string;
  /** Pre-initialized SQLocal client (avoids dynamic import). */
  client?: SqlocalClient;
}

export type StorageConfig = LocalStorageConfig | RemoteStorageConfig | SqlocalStorageConfig;

export interface ServerPageMeta {
  key: string;
  updatedAt: number;
  checksum?: string;
}

export interface ServerFile {
  path: string;
  content: string;
}

export interface ServerSyncAdapter {
  listPages(): Promise<ServerPageMeta[]>;
  listFiles(pageKey: string): Promise<ServerFile[]>;
  saveFiles(pageKey: string, files: ServerFile[]): Promise<void>;
}

export type FrontendSyncStatus =
  | { state: 'loading' }
  | { state: 'saving' }
  | { state: 'idle' }
  | { state: 'error'; message: string };

export interface FrontendSyncOptions {
  pageKey: string;
  storage: StorageAdapter;
  adapter: ServerSyncAdapter;
  includeFiles?: (path: string) => boolean;
  onStatus?: (status: FrontendSyncStatus) => void;
}

export interface ToolbarInitConfig {
  byId?: Record<string, ToolbarConfig>;
  byType?: Record<string, ToolbarConfig>;
  byTag?: Record<string, ToolbarConfig>;
  default?: ToolbarConfig;
}

export interface EditorTsEventMap {
  componentSelect: [component: Component];
  componentInsert: [component: Component, parentId: string | null];
  componentReorder: [component: Component, newParentId: string | null, newIndex: number];

  componentEdit: [component: Component];
  componentEditJS: [component: Component];
  componentDuplicate: [original: Component, duplicate: Component];
  componentDelete: [component: Component];

  pageEditCSS: [body: PageBody];
  pageEditJSON: [body: PageBody];

  pageSaved: [key: string];
  pageLoaded: [key: string];

  textEditStart: [component: Component];
  textUpdate: [component: Component, newContent: string, originalContent: string];
  textEditEnd: [component: Component, saved: boolean];

  imageEditStart: [component: Component, currentSrc: string];
  imageUpdate: [component: Component, newSrc: string, originalSrc: string, fileInfo: ImageFileInfo];
  imageEditEnd: [component: Component, saved: boolean];
}

export type EditorTsEventName = keyof EditorTsEventMap;

export interface EditorTsEditor {
  page: Page;
  storage: StorageManager;
  content: {
    adapter: ContentAdapter;
    load(): Promise<void>;
    save(): Promise<void>;
    describeWorkspace(): Promise<ContentAdapterWorkspaceDescriptor | null>;
    buildAiWorkspace(): Promise<ContentAdapterAiWorkspace | null>;
    describePreview(): Promise<ContentAdapterPreviewDescriptor | null>;
  };
  preview: {
    describe(): Promise<ContentAdapterPreviewDescriptor | null>;
    currentPath(): string | null;
    navigate(path: string | null): Promise<void>;
    refresh(): Promise<void>;
  };
  ai?: EditorTsAiModule;
  vimMode: boolean;
  versionControl?: {
    enabled: boolean;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): Promise<boolean>;
    redo(): Promise<boolean>;
    commit(meta?: { source?: 'user' | 'ai' | 'system'; message?: string }): Promise<void>;
  };
  components: CustomComponentRegistry;
  workspace?: {
    name: string;
    listFiles(): string[];
    readFile(path: string): Promise<string | null>;
    writeFile(path: string, content: string): Promise<void>;
    openFile(path: string): Promise<void>;
  };
  on<K extends EditorTsEventName>(event: K, callback: (...args: EditorTsEventMap[K]) => void): void;
  off<K extends EditorTsEventName>(event: K, callback: (...args: EditorTsEventMap[K]) => void): void;
  refresh(): void;
  save(): string;
  /** Save page to storage */
  saveTo(key: string): Promise<void>;
  /** Load page from storage */
  loadFrom(key: string): Promise<boolean>;
  destroy(): void;
  elements: {
    iframe: EditorTsCanvasElement;
    canvas: EditorTsCanvasElement;
    sidebar?: HTMLElement;
    stats?: HTMLElement;
    selectedInfo?: HTMLElement;
  };
}
