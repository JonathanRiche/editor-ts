import type {
  Component,
  ContentAdapter,
  ContentAdapterCapabilities,
  ContentAdapterFile,
  EditorContentSnapshot,
  MultiPageData,
  PageData,
  PagePayload,
} from '../types';
import { Page } from './Page';
import { JsonContentAdapter } from './JsonContentAdapter';

export interface ProjectFilesystemFileEntry {
  path: string;
  readOnly?: boolean;
  language?: string;
}

export interface ProjectFilesystemProvider {
  listFiles(): Promise<Array<string | ProjectFilesystemFileEntry>>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ProjectFilesystemSaveOptions {
  writePageJson?: boolean;
  writeHtml?: boolean;
  writeCss?: boolean;
  writeComponentScripts?: boolean;
}

export interface ProjectFilesystemAdapterOptions {
  fs: ProjectFilesystemProvider;
  pageJsonPath?: string;
  htmlPath?: string;
  cssPath?: string;
  jsxPath?: string;
  componentScriptsDir?: string;
  loadStrategy?: 'auto' | 'page-json' | 'project-files';
  defaults?: {
    title?: string;
    itemId?: number;
  };
  save?: ProjectFilesystemSaveOptions;
}

type PathResolution = {
  pageJsonPath: string | null;
  htmlPath: string | null;
  cssPath: string | null;
  jsxPath: string | null;
};

const DEFAULT_HTML_CANDIDATES = ['index.html', 'src/index.html'];
const DEFAULT_CSS_CANDIDATES = ['styles.css', 'src/styles.css', 'src/index.css'];
const DEFAULT_JSON_CANDIDATES = ['page.json'];
const DEFAULT_JSX_CANDIDATES = ['index.tsx', 'index.jsx', 'App.tsx', 'App.jsx', 'src/index.tsx', 'src/App.tsx'];

const deepClone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const normalizePath = (path: string): string => {
  return path.replace(/^\.\//, '').replace(/\\/g, '/');
};

const isMultiPageData = (data: PageData | MultiPageData): data is MultiPageData => {
  return !!data && typeof data === 'object' && Array.isArray((data as MultiPageData).pages);
};

const parsePayload = (payload: PagePayload): PageData | MultiPageData => {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as PageData | MultiPageData;
  }
  return payload;
};

const getActivePage = (data: PageData | MultiPageData): PageData => {
  if (isMultiPageData(data)) {
    if (!Array.isArray(data.pages) || data.pages.length === 0) {
      throw new Error('MultiPageData.pages cannot be empty');
    }

    const index = Math.max(0, Math.min(data.activePageIndex ?? 0, data.pages.length - 1));
    data.activePageIndex = index;
    const page = data.pages[index] ?? data.pages[0];
    if (!page) {
      throw new Error('MultiPageData.pages cannot be empty');
    }

    if (!page.body || typeof page.body !== 'object') {
      page.body = {};
    }

    return page;
  }

  if (!data.body || typeof data.body !== 'object') {
    data.body = {};
  }

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

const inferLanguageFromPath = (path: string): string => {
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx') || path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript';
  return 'plaintext';
};

const extractBodyMarkup = (html: string): string => {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (match) {
    return match[1] ?? '';
  }
  return html;
};

const extractTitle = (html: string): string | null => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : null;
};

const replaceBodyMarkup = (htmlDoc: string, bodyMarkup: string, cssPath: string | null, title: string): string => {
  const bodyWithWrapper = `<body>${bodyMarkup}</body>`;

  if (/<body[\s>]/i.test(htmlDoc)) {
    return htmlDoc.replace(/<body([^>]*)>[\s\S]*?<\/body>/i, `<body$1>${bodyMarkup}</body>`);
  }

  const safeCssHref = cssPath ?? 'styles.css';
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8" />',
    `  <title>${title}</title>`,
    `  <link rel="stylesheet" href="${safeCssHref}" />`,
    '</head>',
    bodyWithWrapper,
    '</html>',
  ].join('\n');
};

const collectScripts = (components: Component[], out: Record<string, string>, scriptsDir: string): void => {
  components.forEach((component) => {
    const id = typeof component.attributes?.id === 'string' ? component.attributes.id : null;
    if (id) {
      out[`${scriptsDir}/${id}.js`] = typeof component.script === 'string' ? component.script : '';
    }

    if (Array.isArray(component.components) && component.components.length > 0) {
      collectScripts(component.components, out, scriptsDir);
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

export class ProjectFilesystemAdapter implements ContentAdapter {
  readonly id = 'project-filesystem';
  readonly mode = 'filesystem' as const;
  readonly capabilities: ContentAdapterCapabilities = {
    writable: true,
    supportsFileTree: true,
    supportsComponents: true,
    supportsMultiPage: true,
    supportsHtmlSource: true,
  };

  private readonly fs: ProjectFilesystemProvider;
  private readonly pageJsonPath: string;
  private readonly htmlPath: string;
  private readonly cssPath: string;
  private readonly jsxPath: string;
  private readonly scriptsDir: string;
  private readonly loadStrategy: 'auto' | 'page-json' | 'project-files';
  private readonly defaults: { title: string; itemId?: number };
  private readonly saveOptions: Required<ProjectFilesystemSaveOptions>;

  private snapshot: EditorContentSnapshot;
  private resolvedPaths: PathResolution;

  constructor(options: ProjectFilesystemAdapterOptions) {
    this.fs = options.fs;
    this.pageJsonPath = normalizePath(options.pageJsonPath ?? 'page.json');
    this.htmlPath = normalizePath(options.htmlPath ?? 'index.html');
    this.cssPath = normalizePath(options.cssPath ?? 'styles.css');
    this.jsxPath = normalizePath(options.jsxPath ?? 'index.tsx');
    this.scriptsDir = normalizePath((options.componentScriptsDir ?? 'components').replace(/\/+$/, ''));
    this.loadStrategy = options.loadStrategy ?? 'auto';
    this.defaults = {
      title: options.defaults?.title ?? 'Project Page',
      itemId: options.defaults?.itemId,
    };

    this.saveOptions = {
      writePageJson: options.save?.writePageJson ?? false,
      writeHtml: options.save?.writeHtml ?? true,
      writeCss: options.save?.writeCss ?? true,
      writeComponentScripts: options.save?.writeComponentScripts ?? true,
    };

    this.snapshot = {
      data: JsonContentAdapter.createDefaultPageData(),
      files: [],
    };

    this.resolvedPaths = {
      pageJsonPath: null,
      htmlPath: null,
      cssPath: null,
      jsxPath: null,
    };
  }

  async load(): Promise<EditorContentSnapshot> {
    const files = await this.listFiles();
    this.resolvedPaths = this.resolvePaths(files);

    let data: PageData | MultiPageData;
    const canLoadPageJson = this.loadStrategy === 'auto' || this.loadStrategy === 'page-json';

    if (canLoadPageJson && this.resolvedPaths.pageJsonPath) {
      const raw = await this.readFile(this.resolvedPaths.pageJsonPath);
      if (raw) {
        data = parsePayload(raw);
      } else {
        data = await this.loadFromProjectFiles();
      }
    } else {
      data = await this.loadFromProjectFiles();
    }

    this.snapshot = {
      data: deepClone(data),
      files,
    };

    return deepClone(this.snapshot);
  }

  async save(snapshot: EditorContentSnapshot): Promise<void> {
    const data = parsePayload(snapshot.data);
    this.snapshot = {
      data: deepClone(data),
      files: Array.isArray(snapshot.files) ? deepClone(snapshot.files) : this.snapshot.files,
    };

    const activePage = getActivePage(data);

    const nextPageJsonPath = this.resolvedPaths.pageJsonPath ?? this.pageJsonPath;
    const nextHtmlPath = this.resolvedPaths.htmlPath ?? this.htmlPath;
    const nextCssPath = this.resolvedPaths.cssPath ?? this.cssPath;

    if (this.saveOptions.writePageJson) {
      await this.fs.writeFile(nextPageJsonPath, JSON.stringify(data, null, 2));
    }

    if (this.saveOptions.writeCss) {
      await this.fs.writeFile(nextCssPath, activePage.body.css ?? '');
    }

    if (this.saveOptions.writeHtml) {
      const existingHtml = await this.fs.readFile(nextHtmlPath);
      const currentHtml = new Page(deepClone(activePage)).getHTML();
      const bodyMarkup = extractBodyMarkup(currentHtml);
      const htmlDoc = replaceBodyMarkup(existingHtml ?? '', bodyMarkup, nextCssPath, activePage.title || this.defaults.title);
      await this.fs.writeFile(nextHtmlPath, htmlDoc);
    }

    if (this.saveOptions.writeComponentScripts) {
      const scripts: Record<string, string> = {};
      collectScripts(readComponents(activePage), scripts, this.scriptsDir);

      const writeScriptPaths = Object.keys(scripts).sort((a, b) => a.localeCompare(b));
      for (const path of writeScriptPaths) {
        await this.fs.writeFile(path, scripts[path] ?? '');
      }
    }

    this.snapshot.files = await this.listFiles();
  }

  async listFiles(): Promise<ContentAdapterFile[]> {
    const listed = await this.fs.listFiles();
    return listed
      .map((entry) => {
        if (typeof entry === 'string') {
          const path = normalizePath(entry);
          return {
            path,
            language: inferLanguageFromPath(path),
          } as ContentAdapterFile;
        }

        const path = normalizePath(entry.path);
        return {
          path,
          readOnly: entry.readOnly,
          language: entry.language ?? inferLanguageFromPath(path),
        } as ContentAdapterFile;
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(path: string): Promise<string | null> {
    return this.fs.readFile(normalizePath(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    await this.fs.writeFile(normalizedPath, content);

    const data = parsePayload(this.snapshot.data);
    const activePage = getActivePage(data);

    const pageJsonPath = this.resolvedPaths.pageJsonPath ?? this.pageJsonPath;
    const htmlPath = this.resolvedPaths.htmlPath ?? this.htmlPath;
    const cssPath = this.resolvedPaths.cssPath ?? this.cssPath;

    if (normalizedPath === pageJsonPath) {
      this.snapshot.data = deepClone(parsePayload(content));
      return;
    }

    if (normalizedPath === htmlPath) {
      activePage.body.html = extractBodyMarkup(content);
      this.snapshot.data = deepClone(data);
      return;
    }

    if (normalizedPath === cssPath) {
      activePage.body.css = content;
      this.snapshot.data = deepClone(data);
      return;
    }

    const scriptPrefix = `${this.scriptsDir}/`;
    if (normalizedPath.startsWith(scriptPrefix) && normalizedPath.endsWith('.js')) {
      const id = normalizedPath.slice(scriptPrefix.length, -3);
      if (id.length > 0) {
        const components = readComponents(activePage);
        updateComponentScript(components, id, content);
        writeComponents(activePage, components);
        this.snapshot.data = deepClone(data);
      }
      return;
    }

    this.snapshot.data = deepClone(data);
  }

  private resolvePaths(files: ContentAdapterFile[]): PathResolution {
    const byPath = new Set(files.map((file) => normalizePath(file.path)));

    const resolve = (preferred: string, candidates: string[]): string | null => {
      const normalizedPreferred = normalizePath(preferred);
      if (byPath.has(normalizedPreferred)) {
        return normalizedPreferred;
      }

      for (const candidate of candidates) {
        const normalizedCandidate = normalizePath(candidate);
        if (byPath.has(normalizedCandidate)) {
          return normalizedCandidate;
        }
      }

      return null;
    };

    return {
      pageJsonPath: resolve(this.pageJsonPath, DEFAULT_JSON_CANDIDATES),
      htmlPath: resolve(this.htmlPath, DEFAULT_HTML_CANDIDATES),
      cssPath: resolve(this.cssPath, DEFAULT_CSS_CANDIDATES),
      jsxPath: resolve(this.jsxPath, DEFAULT_JSX_CANDIDATES),
    };
  }

  private async loadFromProjectFiles(): Promise<PageData> {
    const page = JsonContentAdapter.createDefaultPageData();
    page.title = this.defaults.title;
    if (typeof this.defaults.itemId === 'number') {
      page.item_id = this.defaults.itemId;
    }

    const htmlPath = this.resolvedPaths.htmlPath;
    const cssPath = this.resolvedPaths.cssPath;
    const jsxPath = this.resolvedPaths.jsxPath;

    if (htmlPath) {
      const htmlText = await this.readFile(htmlPath);
      if (htmlText) {
        page.body.html = extractBodyMarkup(htmlText);
        const title = extractTitle(htmlText);
        if (title) page.title = title;
      }
    }

    if (cssPath) {
      const cssText = await this.readFile(cssPath);
      if (cssText !== null) {
        page.body.css = cssText;
      }
    }

    // Optional TSX/JSX bootstrap when no HTML file exists.
    if (!htmlPath && jsxPath) {
      const jsxText = await this.readFile(jsxPath);
      if (jsxText && jsxText.trim().length > 0) {
        const jsxPage = new Page(deepClone(page));
        await jsxPage.components.setFromJSX(jsxText);
        const parsed = jsxPage.toObject();
        page.body = parsed.body;
      }
    }

    return page;
  }
}
