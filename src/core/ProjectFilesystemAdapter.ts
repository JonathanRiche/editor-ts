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

export type ProjectFilesystemPermission = 'list' | 'read' | 'edit' | 'external_directory';

export type ProjectFilesystemPermissionAction = 'allow' | 'deny' | 'ask';

export type ProjectFilesystemPermissionReply = 'once' | 'always' | 'reject';

export interface ProjectFilesystemPermissionRule {
  permission: ProjectFilesystemPermission | '*';
  pattern: string;
  action: ProjectFilesystemPermissionAction;
}

export interface ProjectFilesystemPermissionRequest {
  permission: ProjectFilesystemPermission;
  paths: string[];
  metadata: Record<string, unknown>;
}

export interface ProjectFilesystemPermissionsOptions {
  rules?: ProjectFilesystemPermissionRule[];
  defaultAction?: ProjectFilesystemPermissionAction;
  onRequest?: (
    request: ProjectFilesystemPermissionRequest
  ) => ProjectFilesystemPermissionReply | Promise<ProjectFilesystemPermissionReply>;
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
  respectGitignore?: boolean;
  permissions?: ProjectFilesystemPermissionsOptions;
}

type GitignoreRule = {
  sourceDir: string;
  negated: boolean;
  regex: RegExp;
};

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

const escapeRegExp = (value: string): string => {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
};

const wildcardToRegexFragment = (pattern: string): string => {
  let out = '';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? '';

    if (char === '*') {
      const next = pattern[i + 1] ?? '';
      if (next === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      out += '[^/]';
      continue;
    }

    out += escapeRegExp(char);
  }

  return out;
};

const wildcardMatches = (pattern: string, value: string): boolean => {
  if (pattern === '*') return true;

  const normalizedPattern = normalizePath(pattern);
  const regex = new RegExp(`^${wildcardToRegexFragment(normalizedPattern)}$`);
  return regex.test(value);
};

const isAbsolutePath = (path: string): boolean => {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
};

const collapsePathSegments = (path: string): string => {
  if (!path) return '';

  const normalized = normalizePath(path);
  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/|$)/);
  const drive = driveMatch?.[1] ?? '';
  const withoutDrive = drive ? normalized.slice(drive.length) : normalized;
  const hasUnixRoot = withoutDrive.startsWith('/');
  const isAbsolute = Boolean(drive) || hasUnixRoot;

  const segments = withoutDrive.split('/');
  const out: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') continue;

    if (segment === '..') {
      const previous = out[out.length - 1];
      if (previous && previous !== '..') {
        out.pop();
      } else if (!isAbsolute) {
        out.push('..');
      }
      continue;
    }

    out.push(segment);
  }

  const joined = out.join('/');

  if (isAbsolute) {
    if (drive) {
      return `${drive}/${joined}`.replace(/\/+$/, '') || `${drive}/`;
    }
    if (hasUnixRoot) {
      return `/${joined}`.replace(/\/+$/, '') || '/';
    }
  }

  return joined;
};

const pathEscapesProject = (path: string): boolean => {
  const normalized = normalizePath(path);
  if (isAbsolutePath(normalized)) return true;

  let depth = 0;
  const segments = normalized.split('/');

  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (depth === 0) return true;
      depth -= 1;
      continue;
    }
    depth += 1;
  }

  return false;
};

const parentGlob = (path: string): string => {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return '*';
  const parent = normalized.slice(0, idx);
  if (!parent) return '/*';
  return `${parent}/*`;
};

const depthOfPath = (path: string): number => {
  if (!path) return 0;
  return path.split('/').length;
};

const relativeToDirectory = (path: string, directory: string): string | null => {
  if (!directory) return path;
  if (path === directory) return '';
  if (path.startsWith(`${directory}/`)) {
    return path.slice(directory.length + 1);
  }
  return null;
};

const compileGitignoreRules = (sourceDir: string, content: string): GitignoreRule[] => {
  const rules: GitignoreRule[] = [];
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let line = trimmed;

    if (line.startsWith('\\#')) {
      line = line.slice(1);
    } else if (line.startsWith('#')) {
      continue;
    }

    let negated = false;
    if (line.startsWith('\\!')) {
      line = line.slice(1);
    } else if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }

    line = line.trim();
    if (!line) continue;

    const directoryOnly = line.endsWith('/');
    const withoutDirFlag = directoryOnly ? line.slice(0, -1) : line;
    const anchored = withoutDirFlag.startsWith('/');
    const withoutAnchor = anchored ? withoutDirFlag.slice(1) : withoutDirFlag;
    const pattern = withoutAnchor.trim();
    if (!pattern) continue;

    const hasSlash = pattern.includes('/');
    const effectiveHasSlash = hasSlash || anchored;
    const fragment = wildcardToRegexFragment(pattern);

    const regexSource = effectiveHasSlash
      ? (directoryOnly ? `^${fragment}/` : `^${fragment}(?:/|$)`)
      : (directoryOnly ? `(?:^|/)${fragment}/` : `(?:^|/)${fragment}(?:/|$)`);

    rules.push({
      sourceDir,
      negated,
      regex: new RegExp(regexSource),
    });
  }

  return rules;
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
  private readonly respectGitignore: boolean;
  private readonly permissionDefaultAction: ProjectFilesystemPermissionAction;
  private readonly onPermissionRequest?: ProjectFilesystemPermissionsOptions['onRequest'];
  private readonly permissionRules: ProjectFilesystemPermissionRule[];

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
    this.respectGitignore = options.respectGitignore ?? true;

    this.permissionDefaultAction = options.permissions?.defaultAction ?? 'allow';
    this.onPermissionRequest = options.permissions?.onRequest;
    this.permissionRules = [...(options.permissions?.rules ?? [])];

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

  private evaluatePermission(
    permission: ProjectFilesystemPermission,
    path: string
  ): ProjectFilesystemPermissionAction {
    for (let i = this.permissionRules.length - 1; i >= 0; i -= 1) {
      const rule = this.permissionRules[i];
      if (!rule) continue;

      const permissionMatches =
        rule.permission === '*' ||
        rule.permission === permission;

      if (!permissionMatches) continue;
      if (!wildcardMatches(rule.pattern, path)) continue;

      return rule.action;
    }

    if (this.onPermissionRequest) {
      return this.permissionDefaultAction;
    }

    if (this.permissionDefaultAction === 'ask') return 'allow';
    return this.permissionDefaultAction;
  }

  private async authorize(input: {
    permission: ProjectFilesystemPermission;
    paths: string[];
    metadata?: Record<string, unknown>;
    always?: string[];
  }): Promise<void> {
    const paths = input.paths
      .map((path) => normalizePath(path))
      .filter((path) => path.length > 0);

    if (paths.length === 0) return;

    const denied: string[] = [];
    const ask: string[] = [];

    for (const path of paths) {
      const action = this.evaluatePermission(input.permission, path);
      if (action === 'deny') {
        denied.push(path);
        continue;
      }
      if (action === 'ask') {
        ask.push(path);
      }
    }

    if (denied.length > 0) {
      throw new Error(
        `ProjectFilesystemAdapter permission denied for ${input.permission}: ${denied.join(', ')}`
      );
    }

    if (ask.length === 0) return;
    if (!this.onPermissionRequest) {
      throw new Error(
        `ProjectFilesystemAdapter requires permissions.onRequest for ${input.permission}: ${ask.join(', ')}`
      );
    }

    const reply = await this.onPermissionRequest({
      permission: input.permission,
      paths: ask,
      metadata: input.metadata ?? {},
    });

    if (reply === 'reject') {
      throw new Error(
        `ProjectFilesystemAdapter permission rejected for ${input.permission}: ${ask.join(', ')}`
      );
    }

    if (reply === 'always') {
      const alwaysPatterns = (input.always ?? ask)
        .map((pattern) => normalizePath(pattern))
        .filter((pattern) => pattern.length > 0);

      alwaysPatterns.forEach((pattern) => {
        this.permissionRules.push({
          permission: input.permission,
          pattern,
          action: 'allow',
        });
      });
    }
  }

  private async resolvePathWithPermissions(input: {
    rawPath: string;
    permission: Extract<ProjectFilesystemPermission, 'read' | 'edit'>;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const normalized = collapsePathSegments(input.rawPath);
    if (!normalized) {
      throw new Error('Path cannot be empty');
    }

    if (normalized.includes('\0')) {
      throw new Error('Path contains invalid null character');
    }

    const external = pathEscapesProject(normalized);
    if (external) {
      const glob = parentGlob(normalized);
      await this.authorize({
        permission: 'external_directory',
        paths: [glob],
        always: [glob],
        metadata: {
          rawPath: input.rawPath,
          path: normalized,
          ...input.metadata,
        },
      });
    }

    await this.authorize({
      permission: input.permission,
      paths: [normalized],
      always: ['*'],
      metadata: {
        rawPath: input.rawPath,
        path: normalized,
        external,
        ...input.metadata,
      },
    });

    return normalized;
  }

  private async readSourceFile(path: string, metadata?: Record<string, unknown>): Promise<string | null> {
    const normalizedPath = await this.resolvePathWithPermissions({
      rawPath: path,
      permission: 'read',
      metadata,
    });

    return this.fs.readFile(normalizedPath);
  }

  private async writeSourceFile(path: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const normalizedPath = await this.resolvePathWithPermissions({
      rawPath: path,
      permission: 'edit',
      metadata,
    });

    await this.fs.writeFile(normalizedPath, content);
  }

  async load(): Promise<EditorContentSnapshot> {
    await this.authorize({
      permission: 'list',
      paths: ['*'],
      always: ['*'],
      metadata: { source: 'load' },
    });

    const files = await this.listFilesInternal({ respectGitignore: false });
    this.resolvedPaths = this.resolvePaths(files);

    let data: PageData | MultiPageData;
    const hasProjectFileSources = !!(
      this.resolvedPaths.htmlPath
      || this.resolvedPaths.cssPath
      || this.resolvedPaths.jsxPath
    );

    const shouldLoadPageJson = this.loadStrategy === 'page-json'
      || (this.loadStrategy === 'auto' && !hasProjectFileSources);

    if (shouldLoadPageJson && this.resolvedPaths.pageJsonPath) {
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
      await this.writeSourceFile(nextPageJsonPath, JSON.stringify(data, null, 2), {
        source: 'save',
        target: 'page-json',
      });
    }

    if (this.saveOptions.writeCss) {
      await this.writeSourceFile(nextCssPath, activePage.body.css ?? '', {
        source: 'save',
        target: 'css',
      });
    }

    if (this.saveOptions.writeHtml) {
      const existingHtml = await this.readSourceFile(nextHtmlPath, {
        source: 'save',
        target: 'html',
      });
      const currentHtml = new Page(deepClone(activePage)).getHTML();
      const bodyMarkup = extractBodyMarkup(currentHtml);
      const htmlDoc = replaceBodyMarkup(existingHtml ?? '', bodyMarkup, nextCssPath, activePage.title || this.defaults.title);
      await this.writeSourceFile(nextHtmlPath, htmlDoc, {
        source: 'save',
        target: 'html',
      });
    }

    if (this.saveOptions.writeComponentScripts) {
      const scripts: Record<string, string> = {};
      collectScripts(readComponents(activePage), scripts, this.scriptsDir);

      const writeScriptPaths = Object.keys(scripts).sort((a, b) => a.localeCompare(b));
      for (const path of writeScriptPaths) {
        await this.writeSourceFile(path, scripts[path] ?? '', {
          source: 'save',
          target: 'component-script',
        });
      }
    }

    this.snapshot.files = await this.listFiles();
  }

  async listFiles(): Promise<ContentAdapterFile[]> {
    await this.authorize({
      permission: 'list',
      paths: ['*'],
      always: ['*'],
      metadata: { source: 'listFiles' },
    });

    return this.listFilesInternal({ respectGitignore: this.respectGitignore });
  }

  private async listFilesInternal(options: { respectGitignore: boolean }): Promise<ContentAdapterFile[]> {
    const listed = await this.fs.listFiles();
    const mapped = listed
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

    if (!options.respectGitignore) {
      return mapped;
    }

    return this.filterWithGitignoreRules(mapped);
  }

  private async filterWithGitignoreRules(files: ContentAdapterFile[]): Promise<ContentAdapterFile[]> {
    const gitignorePaths = files
      .map((file) => file.path)
      .filter((path) => path === '.gitignore' || path.endsWith('/.gitignore'))
      .sort((a, b) => {
        const depthDelta = depthOfPath(a) - depthOfPath(b);
        if (depthDelta !== 0) return depthDelta;
        return a.localeCompare(b);
      });

    if (gitignorePaths.length === 0) {
      return files;
    }

    const rules: GitignoreRule[] = [];
    for (const gitignorePath of gitignorePaths) {
      const content = await this.fs.readFile(gitignorePath);
      if (content === null) continue;

      const lastSlash = gitignorePath.lastIndexOf('/');
      const sourceDir = lastSlash >= 0 ? gitignorePath.slice(0, lastSlash) : '';
      rules.push(...compileGitignoreRules(sourceDir, content));
    }

    if (rules.length === 0) {
      return files;
    }

    return files.filter((file) => {
      let ignored = false;

      for (const rule of rules) {
        const relativePath = relativeToDirectory(file.path, rule.sourceDir);
        if (relativePath === null || relativePath === '') continue;

        if (rule.regex.test(relativePath)) {
          ignored = !rule.negated;
        }
      }

      return !ignored;
    });
  }

  async readFile(path: string): Promise<string | null> {
    return this.readSourceFile(path, { source: 'readFile' });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalizedPath = await this.resolvePathWithPermissions({
      rawPath: path,
      permission: 'edit',
      metadata: { source: 'writeFile' },
    });
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
