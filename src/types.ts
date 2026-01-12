/**
 * Core type definitions for the HTML content editing library
 */

export interface PageData {
  title: string;
  item_id: number;
  body: PageBody;
}

export interface PageBody {
  html: string;
  components: string | Component[]; // JSON string of Component[]
  assets: Asset[];
  css: string;
  styles: Style[];
}

export interface Component {
  type: string;
  attributes?: Record<string, any>;
  components?: Component[];
  tagName?: string;
  void?: boolean;
  style?: string;
  script?: string;
  content?: string;  // Text content for the component
  [key: string]: any;
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
  attributes?: Record<string, any>;
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
  | { attributes: Record<string, any> }
  | { custom: (component: Component) => boolean };

export interface InitConfig {
  // Required: iframe element ID (user creates this in their HTML)
  iframeId: string;

  // Required: page data
  data: PageData | string;

  // Optional: toolbar configuration (runtime only)
  toolbars?: ToolbarInitConfig;

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
}

export interface ToolbarInitConfig {
  byId?: Record<string, ToolbarConfig>;
  byType?: Record<string, ToolbarConfig>;
  byTag?: Record<string, ToolbarConfig>;
  default?: ToolbarConfig;
}

export interface EditorTsEditor {
  page: any; // Page class (avoid circular dependency)
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  refresh(): void;
  save(): string;
  destroy(): void;
  elements: {
    iframe: HTMLIFrameElement;
    sidebar?: HTMLElement;
    stats?: HTMLElement;
    selectedInfo?: HTMLElement;
  };
}
