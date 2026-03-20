/**
 * EditorTs - TypeScript library for HTML content editing with JSON representation
 * 
 * @example
 * ```typescript
 * import { Page } from 'editorts';
 * 
 * // Load from JSON
 * const page = new Page(jsonData);
 * 
 * // Find and update components
 * const header = page.components.findById('header');
 * page.components.updateComponent('header', { style: 'color: red;' });
 * 
 * // Manage styles
 * page.styles.updateStyle('#header', { 'font-size': '2rem' });
 * 
 * // Export back to JSON
 * const json = page.toJSON();
 * ```
 */

// Core exports
export { Page } from './src/core/Page';
export { ComponentManager } from './src/core/ComponentManager';
export { StyleManager } from './src/core/StyleManager';
export { AssetManager } from './src/core/AssetManager';
export { ToolbarManager } from './src/core/ToolbarManager';
export { LayerManager } from './src/core/LayerManager';
export { JsonContentAdapter } from './src/core/JsonContentAdapter';
export { ProjectFilesystemAdapter } from './src/core/ProjectFilesystemAdapter';
export { createHttpProjectProvider } from './src/core/HttpProjectProvider';
export { StorageManager, LocalStorageAdapter, RemoteStorageAdapter, SqlocalStorageAdapter, type SqlocalClient } from './src/core/StorageManager';
export { syncFrontendWithServer } from './src/server/sync';
export { init } from './src/core/init';
export { defaultComponentRegistry, mergeCustomComponentRegistry, createCustomComponentDefinition, defaultComponentFactories } from './src/core/CustomComponentRegistry';
export {
  requestAiReplacements,
  parseAiChatResponse,
  applyAiReplacementsToPage,
  applyAiReplacementsToFiles,
  extractAiChatRequestText,
  extractAiReplacementPaths,
  summarizeAiAssistantText,
  buildAiChatSystemPrompt,
  buildAiChatSystemPromptWithOptions,
  buildAiChatSnapshot,
  buildAiChatSnapshotFromFiles,
  chooseChatModel,
} from './src/core/aiChat';
export { VersionControl } from './src/core/VersionControl';
export { KeyboardShortcuts, createDefaultShortcuts } from './src/core/KeyboardShortcuts';

// Server schema exports (drizzle)
export { pages, pageFiles } from './src/server/schema';

// Type exports
export type {
  PageData,
  MultiPageData,
  PageBody,
  Component,
  Asset,
  Style,
  CSSProperties,
  ComponentQuery,
  StyleQuery,
  UpdateOptions,
  SelectorObject,
  ParsedComponents,
  ToolbarConfig,
  ToolbarAction,
  ToolbarRule,
  ComponentSelector,
  InitConfig,
  ToolbarInitConfig,
  EditorTsEditor,
  AiProviderConfig,
  EditorTsAiModule,
  ImageFileInfo,
  StorageConfig,
  LocalStorageConfig,
  RemoteStorageConfig,
  SqlocalStorageConfig,
  ServerPageMeta,
  ServerFile,
  ServerSyncAdapter,
  FrontendSyncStatus,
  FrontendSyncOptions,
  CustomComponentDefinition,
  CustomComponentRegistry,
  UiRender,
  PagesRenderProps,
  PagePayload,
  ContentAdapterMode,
  ContentAdapterAiWorkspace,
  ContentAdapterFile,
  EditorContentSnapshot,
  ContentAdapterCapabilities,
  ContentAdapterWorkspaceDescriptor,
  ContentAdapterPreviewDescriptor,
  ContentPreviewMode,
  ContentPreviewRoute,
  EditorTsCanvasKind,
  EditorTsCanvasElement,
  EditorTsElectrobunWebviewElement,
  ContentWorkspaceKind,
  ContentWorkspaceRuntime,
  ContentAdapter,
  EditorTsSyncMessage,
  EditorTsSyncAck,
  EditorTsSyncEnvelope,
} from './src/types';


export type { LayerManagerConfig } from './src/core/LayerManager';
export type { StorageAdapter } from './src/core/StorageManager';
export type {
  ProjectFilesystemFileEntry,
  ProjectFilesystemProvider,
  ProjectFilesystemSaveOptions,
  ProjectFilesystemPermission,
  ProjectFilesystemPermissionAction,
  ProjectFilesystemPermissionReply,
  ProjectFilesystemPermissionRule,
  ProjectFilesystemPermissionRequest,
  ProjectFilesystemPermissionsOptions,
  ProjectFilesystemAdapterOptions,
  ProjectFilesystemWorkspaceOptions,
  ProjectFilesystemAiWorkspaceOptions,
  ProjectFilesystemPreviewOptions,
  ProjectFilesystemRouteDiscoveryOptions,
} from './src/core/ProjectFilesystemAdapter';
export type { HttpProjectProviderConfig, HttpProjectProviderHeaders } from './src/core/HttpProjectProvider';

// Server exports
export {
  createPageMeta,
} from './src/server/sync';
export type { PageMeta, PageMetaStore } from './src/server/sync';
export { createBunPageMetaStore } from './src/server/bun_server';
export {
  createCfPageMetaStore,
  EditorTsPageMetaDurableObject,
  EditorTsPageMetaIndexDurableObject,
  type DurableObjectNamespace,
  type DurableObjectState,
  type DurableObjectStorage,
  type DurableObjectId,
  type DurableObjectStub,
} from './src/server/cf_worker';

// Utility exports
export {
  deepClone,
  generateId,
  cssObjectToString,
  cssStringToObject,
  flattenComponents,
  getComponentByPath,
  sanitizeHTML,
  extractComponentIds,
  mergeCSSProperties,
  isIdSelector,
  isClassSelector,
  parseSelector,
  formatFileSize,
  isValidURL,
  extractDomain,
} from './src/utils/helpers';

export {
  createSyncAck,
  createSyncMessage,
  isSyncAck,
  isSyncMessage,
  parseSyncEnvelope,
} from './src/server/sync';

export { createBunSyncServer } from './src/server/bun_server';
export { createCfSyncWorker } from './src/server/cf_worker';

// Toolbar exports
export {
  defaultToolbarActions,
  defaultToolbarConfig,
  createToolbarConfig,
  mergeToolbarConfigs,
  getEnabledActions,
  findToolbarAction,
  toolbarPresets,
} from './src/utils/toolbar';
