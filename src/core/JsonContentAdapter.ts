import type {
  Component,
  ContentAdapter,
  ContentAdapterFile,
  EditorContentSnapshot,
  MultiPageData,
  PageData,
  PagePayload,
} from '../types';
import { Page } from './Page';

const isMultiPageData = (data: PageData | MultiPageData): data is MultiPageData => {
  return !!data && typeof data === 'object' && Array.isArray((data as MultiPageData).pages);
};

const deepClone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const parsePayload = (payload: PagePayload): PageData | MultiPageData => {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as PageData | MultiPageData;
  }
  return payload;
};

const normalizeBody = (page: PageData): void => {
  if (!page.body || typeof page.body !== 'object') {
    page.body = {};
  }
};

const normalizeMultiPageIndex = (data: MultiPageData): number => {
  if (!Array.isArray(data.pages) || data.pages.length === 0) {
    throw new Error('MultiPageData.pages cannot be empty');
  }

  const rawIndex = typeof data.activePageIndex === 'number' ? data.activePageIndex : 0;
  const bounded = Math.max(0, Math.min(rawIndex, data.pages.length - 1));
  data.activePageIndex = bounded;
  return bounded;
};

const getActivePage = (data: PageData | MultiPageData): PageData => {
  if (isMultiPageData(data)) {
    const index = normalizeMultiPageIndex(data);
    const page = data.pages[index] ?? data.pages[0];
    if (!page) {
      throw new Error('MultiPageData.pages cannot be empty');
    }
    normalizeBody(page);
    return page;
  }

  normalizeBody(data);
  return data;
};

const readComponents = (page: PageData): Component[] => {
  const raw = page.body.components;

  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as Component[];
      }
    } catch {
      return [];
    }
  }

  return [];
};

const writeComponents = (page: PageData, components: Component[]): void => {
  page.body.components = components;
};

const collectScripts = (components: Component[], out: Record<string, string>): void => {
  components.forEach((component) => {
    const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
    if (id) {
      out[`components/${id}.js`] = typeof component.script === 'string' ? component.script : '';
    }

    if (Array.isArray(component.components) && component.components.length > 0) {
      collectScripts(component.components, out);
    }
  });
};

const updateComponentScript = (components: Component[], id: string, script: string): boolean => {
  for (const component of components) {
    const componentId = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
    if (componentId === id) {
      component.script = script;
      return true;
    }

    if (Array.isArray(component.components) && component.components.length > 0) {
      const updated = updateComponentScript(component.components, id, script);
      if (updated) return true;
    }
  }
  return false;
};

const inferLanguageFromPath = (path: string): string => {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.html')) return 'html';
  return 'plaintext';
};

export class JsonContentAdapter implements ContentAdapter {
  readonly id = 'json';
  readonly mode = 'json' as const;
  readonly capabilities = {
    writable: true,
    supportsFileTree: true,
    supportsComponents: true,
    supportsMultiPage: true,
    supportsHtmlSource: true,
  };

  private snapshot: EditorContentSnapshot;

  constructor(initialData?: PagePayload) {
    const seed = initialData ?? JsonContentAdapter.createDefaultPageData();
    const parsed = parsePayload(seed);

    this.snapshot = {
      data: deepClone(parsed),
    };
  }

  static createDefaultPageData(): PageData {
    return {
      title: 'Untitled',
      item_id: Date.now(),
      body: {
        html: '',
        components: [],
        css: '',
        styles: [],
        assets: [],
      },
    };
  }

  async load(): Promise<EditorContentSnapshot> {
    return deepClone(this.snapshot);
  }

  async save(snapshot: EditorContentSnapshot): Promise<void> {
    const parsed = parsePayload(snapshot.data);
    this.snapshot = {
      data: deepClone(parsed),
      files: Array.isArray(snapshot.files) ? deepClone(snapshot.files) : undefined,
    };
  }

  async listFiles(): Promise<ContentAdapterFile[]> {
    const files = this.buildVirtualFiles();
    return Object.keys(files)
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({
        path,
        language: inferLanguageFromPath(path),
      }));
  }

  async readFile(path: string): Promise<string | null> {
    const files = this.buildVirtualFiles();
    return Object.prototype.hasOwnProperty.call(files, path) ? (files[path] ?? null) : null;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const parsed = parsePayload(this.snapshot.data);

    if (path === 'page.json') {
      const next = JSON.parse(content) as PageData | MultiPageData;
      this.snapshot = {
        ...this.snapshot,
        data: deepClone(next),
      };
      return;
    }

    const activePage = getActivePage(parsed);

    if (path === 'styles.css') {
      activePage.body.css = content;
      this.snapshot = {
        ...this.snapshot,
        data: deepClone(parsed),
      };
      return;
    }

    if (path === 'index.html') {
      activePage.body.html = content;
      this.snapshot = {
        ...this.snapshot,
        data: deepClone(parsed),
      };
      return;
    }

    if (path.startsWith('components/') && path.endsWith('.js')) {
      const id = path.slice('components/'.length, -3);
      if (!id) {
        throw new Error('Invalid component script path. Expected components/<id>.js');
      }

      const components = readComponents(activePage);
      const updated = updateComponentScript(components, id, content);
      if (!updated) {
        throw new Error(`Component not found for script path: ${path}`);
      }

      writeComponents(activePage, components);
      this.snapshot = {
        ...this.snapshot,
        data: deepClone(parsed),
      };
      return;
    }

    throw new Error(`Unsupported file path for JsonContentAdapter: ${path}`);
  }

  private buildVirtualFiles(): Record<string, string> {
    const parsed = parsePayload(this.snapshot.data);
    const activePage = getActivePage(parsed);
    const files: Record<string, string> = {};

    files['page.json'] = JSON.stringify(parsed, null, 2);
    files['styles.css'] = activePage.body.css ?? '';

    const html = new Page(deepClone(activePage)).getHTML();
    files['index.html'] = `<!DOCTYPE html><html><head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>${html}</html>`;

    const components = readComponents(activePage);
    const scripts: Record<string, string> = {};
    collectScripts(components, scripts);
    Object.entries(scripts).forEach(([path, script]) => {
      files[path] = script;
    });

    return files;
  }
}
