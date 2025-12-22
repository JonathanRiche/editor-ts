import type { PageData, PageBody } from '../types';
import { ComponentManager } from './ComponentManager';
import { StyleManager } from './StyleManager';
import { AssetManager } from './AssetManager';
import { ToolbarManager } from './ToolbarManager';

/**
 * Main class for managing page content
 */
export class Page {
  private data: PageData;
  public components: ComponentManager;
  public styles: StyleManager;
  public assets: AssetManager;
  public toolbars: ToolbarManager;

  constructor(pageData: PageData | string) {
    if (typeof pageData === 'string') {
      this.data = JSON.parse(pageData) as PageData;
    } else {
      this.data = pageData;
    }

    // Initialize managers
    this.components = new ComponentManager(this.data.body);
    this.styles = new StyleManager(this.data.body);
    this.assets = new AssetManager(this.data.body);
    this.toolbars = new ToolbarManager();
  }

  /**
   * Get the page title
   */
  getTitle(): string {
    return this.data.title;
  }

  /**
   * Set the page title
   */
  setTitle(title: string): void {
    this.data.title = title;
  }

  /**
   * Get the page item ID
   */
  getItemId(): number {
    return this.data.item_id;
  }

  /**
   * Set the page item ID
   */
  setItemId(itemId: number): void {
    this.data.item_id = itemId;
  }

  /**
   * Get the raw HTML
   */
  getHTML(): string {
    return this.data.body.html;
  }

  /**
   * Set the raw HTML
   */
  setHTML(html: string): void {
    this.data.body.html = html;
  }

  /**
   * Get the compiled CSS
   */
  getCSS(): string {
    return this.data.body.css;
  }

  /**
   * Set the compiled CSS
   */
  setCSS(css: string): void {
    this.data.body.css = css;
  }

  /**
   * Get the page body
   */
  getBody(): PageBody {
    return this.data.body;
  }

  /**
   * Export the page as JSON string
   */
  toJSON(): string {
    // Sync all managers back to data
    this.components.sync();
    this.styles.sync();
    this.assets.sync();
    
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Export the page as object
   */
  toObject(): PageData {
    // Sync all managers back to data
    this.components.sync();
    this.styles.sync();
    this.assets.sync();
    
    return this.data;
  }

  /**
   * Load page from JSON file
   */
  static fromJSON(json: string): Page {
    return new Page(json);
  }

  /**
   * Clone the page
   */
  clone(): Page {
    return new Page(JSON.parse(JSON.stringify(this.data)));
  }

  /**
   * Get raw page data
   */
  getRawData(): PageData {
    return this.data;
  }
}
