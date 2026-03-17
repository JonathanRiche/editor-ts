/**
 * StorageManager - Handles saving/loading page data and assets
 * Supports pluggable adapters: localStorage (default) or remote server
 */

export interface StorageAdapter {
  /** Save page data */
  savePage(key: string, data: string): Promise<void>;
  /** Load page data */
  loadPage(key: string): Promise<string | null>;
  /** Delete page data */
  deletePage(key: string): Promise<void>;
  /** Upload an image and return the URL */
  uploadImage(file: File | Blob, filename?: string): Promise<string>;
  /** Delete an image */
  deleteImage(url: string): Promise<void>;
  /** List all saved pages */
  listPages(): Promise<string[]>;
}

export interface LocalStorageConfig {
  /**
   * Local storage is the default when `storage` is omitted.
   *
   * This field is optional to allow concise configs like:
   *   { prefix: 'myapp_' }
   */
  type?: 'local';
  prefix?: string; // Key prefix for localStorage, default: 'editorts_'
}

export interface RemoteStorageConfig {
  type: 'remote';
  baseUrl: string;
  /** How to send images: 'form' (multipart/form-data) or 'json' (base64 in JSON body) */
  imageUploadMethod?: 'form' | 'json';
  /** Custom headers for requests (e.g., Authorization) */
  headers?: Record<string, string>;
  /** Endpoint paths (relative to baseUrl) */
  endpoints?: {
    savePage?: string;      // Default: '/pages'
    loadPage?: string;      // Default: '/pages/:key'
    deletePage?: string;    // Default: '/pages/:key'
    uploadImage?: string;   // Default: '/images'
    deleteImage?: string;   // Default: '/images/:id'
    listPages?: string;     // Default: '/pages'
  };
}

export type SqlocalClient = {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>;
};

export interface SqlocalStorageConfig {
  type: 'sqlocal';
  /** SQLite database file name stored in OPFS (used when `client` is not provided). */
  databaseName?: string;
  /** Pre-initialized SQLocal client (avoids dynamic import). */
  client?: SqlocalClient;
}

export type StorageConfig = LocalStorageConfig | RemoteStorageConfig | SqlocalStorageConfig;

/**
 * LocalStorage Adapter - Stores data in browser localStorage
 */
export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(config?: LocalStorageConfig) {
    this.prefix = config?.prefix || 'editorts_';
  }

  async savePage(key: string, data: string): Promise<void> {
    localStorage.setItem(this.prefix + 'page_' + key, data);
  }

  async loadPage(key: string): Promise<string | null> {
    return localStorage.getItem(this.prefix + 'page_' + key);
  }

  async deletePage(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + 'page_' + key);
  }

  async uploadImage(file: File | Blob, filename?: string): Promise<string> {
    // Convert to data URL and store in localStorage
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const imageKey = this.prefix + 'img_' + (filename || Date.now().toString());
        localStorage.setItem(imageKey, dataUrl);
        // Return the key as the "URL" - can be retrieved later
        resolve(dataUrl);
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  async deleteImage(url: string): Promise<void> {
    // If it's a localStorage key, remove it
    if (url.startsWith(this.prefix + 'img_')) {
      localStorage.removeItem(url);
    }
    // If it's a data URL stored with a key, we can't easily find it
    // Data URLs are self-contained, so nothing to clean up
  }

  async listPages(): Promise<string[]> {
    const pages: string[] = [];
    const prefix = this.prefix + 'page_';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        pages.push(key.substring(prefix.length));
      }
    }
    return pages;
  }
}

/**
 * Remote Storage Adapter - Stores data on a remote server
 */
export class RemoteStorageAdapter implements StorageAdapter {
  private baseUrl: string;
  private imageUploadMethod: 'form' | 'json';
  private headers: Record<string, string>;
  private endpoints: Required<NonNullable<RemoteStorageConfig['endpoints']>>;

  constructor(config: RemoteStorageConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.imageUploadMethod = config.imageUploadMethod || 'form';
    this.headers = config.headers || {};
    this.endpoints = {
      savePage: config.endpoints?.savePage || '/pages',
      loadPage: config.endpoints?.loadPage || '/pages/:key',
      deletePage: config.endpoints?.deletePage || '/pages/:key',
      uploadImage: config.endpoints?.uploadImage || '/images',
      deleteImage: config.endpoints?.deleteImage || '/images/:id',
      listPages: config.endpoints?.listPages || '/pages',
    };
  }

  private buildUrl(endpoint: string, params?: Record<string, string>): string {
    let url = this.baseUrl + endpoint;
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url = url.replace(`:${key}`, encodeURIComponent(value));
      });
    }
    return url;
  }

  async savePage(key: string, data: string): Promise<void> {
    const response = await fetch(this.buildUrl(this.endpoints.savePage), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ key, data }),
    });
    if (!response.ok) {
      throw new Error(`Failed to save page: ${response.statusText}`);
    }
  }

  async loadPage(key: string): Promise<string | null> {
    const response = await fetch(this.buildUrl(this.endpoints.loadPage, { key }), {
      method: 'GET',
      headers: this.headers,
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to load page: ${response.statusText}`);
    }
    const result = await response.json();
    return result.data || null;
  }

  async deletePage(key: string): Promise<void> {
    const response = await fetch(this.buildUrl(this.endpoints.deletePage, { key }), {
      method: 'DELETE',
      headers: this.headers,
    });
    if (!response.ok) {
      throw new Error(`Failed to delete page: ${response.statusText}`);
    }
  }

  async uploadImage(file: File | Blob, filename?: string): Promise<string> {
    let response: Response;

    if (this.imageUploadMethod === 'form') {
      // Multipart form data upload
      const formData = new FormData();
      formData.append('image', file, filename || 'image');

      response = await fetch(this.buildUrl(this.endpoints.uploadImage), {
        method: 'POST',
        headers: this.headers, // Don't set Content-Type for FormData
        body: formData,
      });
    } else {
      // JSON with base64 upload
      const base64 = await this.fileToBase64(file);
      response = await fetch(this.buildUrl(this.endpoints.uploadImage), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          filename: filename || 'image',
          data: base64,
          contentType: file.type,
        }),
      });
    }

    if (!response.ok) {
      throw new Error(`Failed to upload image: ${response.statusText}`);
    }

    const result = await response.json();
    return result.url;
  }

  async deleteImage(url: string): Promise<void> {
    // Extract ID from URL (assumes URL ends with /images/:id or similar)
    const parts = url.split('/');
    const id = parts[parts.length - 1] || '';

    const response = await fetch(this.buildUrl(this.endpoints.deleteImage, { id }), {
      method: 'DELETE',
      headers: this.headers,
    });
    if (!response.ok) {
      throw new Error(`Failed to delete image: ${response.statusText}`);
    }
  }

  async listPages(): Promise<string[]> {
    const response = await fetch(this.buildUrl(this.endpoints.listPages), {
      method: 'GET',
      headers: this.headers,
    });
    if (!response.ok) {
      throw new Error(`Failed to list pages: ${response.statusText}`);
    }
    const result = await response.json();
    return result.pages || [];
  }

  private fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // Extract base64 part (remove data:mime;base64, prefix)
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}

type SqlocalModule = {
  SQLocal: new (databaseName: string) => SqlocalClient;
};


export class SqlocalStorageAdapter implements StorageAdapter {
  private databaseName: string;
  private client: SqlocalClient | null;
  private sqlocalPromise: Promise<SqlocalClient> | null = null;

  constructor(config?: SqlocalStorageConfig) {
    this.databaseName = config?.databaseName || 'editorts.sqlite';
    this.client = config?.client ?? null;
  }

  private async ensureSchema(client: SqlocalClient): Promise<void> {
    await client.sql`
      CREATE TABLE IF NOT EXISTS editor_pages (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `;
    await client.sql`
      CREATE TABLE IF NOT EXISTS editor_images (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `;
  }

  private async loadClient(): Promise<SqlocalClient> {
    if (this.client) {
      await this.ensureSchema(this.client);
      return this.client;
    }

    if (!this.sqlocalPromise) {
      this.sqlocalPromise = (async () => {
        try {
          const module = (await import('sqlocal')) as unknown as SqlocalModule;
          const { SQLocal } = module;
          const client = new SQLocal(this.databaseName);
          await this.ensureSchema(client);
          return client;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to load sqlocal: ${message}`);
        }
      })();
    }

    return this.sqlocalPromise;
  }

  async savePage(key: string, data: string): Promise<void> {
    const { sql } = await this.loadClient();
    await sql`
      INSERT INTO editor_pages (key, data)
      VALUES (${key}, ${data})
      ON CONFLICT(key) DO UPDATE SET data = excluded.data
    `;
  }

  async loadPage(key: string): Promise<string | null> {
    const { sql } = await this.loadClient();
    const rows = await sql`
      SELECT data FROM editor_pages WHERE key = ${key} LIMIT 1
    `;
    const result = rows[0] as { data?: unknown } | undefined;
    return typeof result?.data === 'string' ? result.data : null;
  }

  async deletePage(key: string): Promise<void> {
    const { sql } = await this.loadClient();
    await sql`
      DELETE FROM editor_pages WHERE key = ${key}
    `;
  }

  async uploadImage(file: File | Blob, filename?: string): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });

    const { sql } = await this.loadClient();
    const imageKey = filename || `${Date.now()}`;
    await sql`
      INSERT INTO editor_images (key, data)
      VALUES (${imageKey}, ${dataUrl})
      ON CONFLICT(key) DO UPDATE SET data = excluded.data
    `;
    return dataUrl;
  }

  async deleteImage(url: string): Promise<void> {
    const { sql } = await this.loadClient();
    await sql`
      DELETE FROM editor_images WHERE data = ${url}
    `;
  }

  async listPages(): Promise<string[]> {
    const { sql } = await this.loadClient();
    const rows = await sql`
      SELECT key FROM editor_pages ORDER BY key
    `;
    return rows
      .map((row) => (row as { key?: unknown }).key)
      .filter((key): key is string => typeof key === 'string');
  }
}

/**
 * StorageManager - Main class for managing storage
 */
export class StorageManager {
  private adapter: StorageAdapter;

  constructor(config?: StorageConfig) {
    // Local storage is the default.
    // Only use remote storage when explicitly requested.
    if (!config || config.type === 'local') {
      this.adapter = new LocalStorageAdapter(config as LocalStorageConfig | undefined);
    } else if (config.type === 'remote') {
      this.adapter = new RemoteStorageAdapter(config);
    } else {
      this.adapter = new SqlocalStorageAdapter(config as SqlocalStorageConfig);
    }
  }

  /** Save page data */
  async savePage(key: string, data: string): Promise<void> {
    return this.adapter.savePage(key, data);
  }

  /** Load page data */
  async loadPage(key: string): Promise<string | null> {
    return this.adapter.loadPage(key);
  }

  /** Delete page data */
  async deletePage(key: string): Promise<void> {
    return this.adapter.deletePage(key);
  }

  /** Upload an image and return the URL */
  async uploadImage(file: File | Blob, filename?: string): Promise<string> {
    return this.adapter.uploadImage(file, filename);
  }

  /** Delete an image */
  async deleteImage(url: string): Promise<void> {
    return this.adapter.deleteImage(url);
  }

  /** List all saved pages */
  async listPages(): Promise<string[]> {
    return this.adapter.listPages();
  }

  /** Get the underlying adapter */
  getAdapter(): StorageAdapter {
    return this.adapter;
  }

  /** Set a custom adapter */
  setAdapter(adapter: StorageAdapter): void {
    this.adapter = adapter;
  }
}
