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
  components: string; // JSON string of Component[]
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
  containerId: string;
  data: PageData | string;
  toolbars?: ToolbarInitConfig;
  ui?: UIConfig;
  onComponentSelect?: (component: Component) => void;
  onComponentEdit?: (component: Component) => void;
  onComponentDelete?: (component: Component) => void;
  onComponentDuplicate?: (component: Component, duplicate: Component) => void;
}

export interface ToolbarInitConfig {
  byId?: Record<string, ToolbarConfig>;
  byType?: Record<string, ToolbarConfig>;
  byTag?: Record<string, ToolbarConfig>;
  default?: ToolbarConfig;
}

export interface UIConfig {
  showSidebar?: boolean;
  sidebarWidth?: number;
  showStats?: boolean;
}

export interface SuperTabEditor {
  page: any; // Page class (avoid circular dependency)
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
  refresh(): void;
  save(): string;
  destroy(): void;
  elements: {
    container: HTMLElement;
    sidebar?: HTMLElement;
    canvas: HTMLElement;
    iframe: HTMLIFrameElement;
  };
}
