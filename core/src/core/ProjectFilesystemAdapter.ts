import type {
  Component,
  ContentAdapter,
  ContentAdapterAiWorkspace,
  ContentAdapterCapabilities,
  ContentAdapterFile,
  ContentAdapterPreviewDescriptor,
  ContentAdapterWorkspaceDescriptor,
  ContentPreviewMode,
  ContentPreviewRoute,
  ContentWorkspaceKind,
  ContentWorkspaceRuntime,
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
  workspace?: ProjectFilesystemWorkspaceOptions;
  aiWorkspace?: ProjectFilesystemAiWorkspaceOptions;
  preview?: ProjectFilesystemPreviewOptions;
}

export interface ProjectFilesystemWorkspaceOptions {
  kind?: ContentWorkspaceKind | 'auto';
  runtime?: ContentWorkspaceRuntime | 'auto';
  entryCandidates?: string[];
}

export interface ProjectFilesystemAiWorkspaceOptions {
  mode?: 'auto' | 'canonical' | 'project-files';
  includePageJson?: boolean;
  includeDerivedHtml?: boolean;
  includeComponentScripts?: boolean;
}

export interface ProjectFilesystemRouteDiscoveryOptions {
  enabled?: boolean;
  roots?: string[];
}

export interface ProjectFilesystemPreviewOptions {
  mode?: 'auto' | ContentPreviewMode;
  appBaseUrl?: string;
  defaultRoute?: string;
  routeDiscovery?: ProjectFilesystemRouteDiscoveryOptions;
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
const DEFAULT_APP_ENTRY_CANDIDATES = [
  'index.html',
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'src/index.tsx',
  'src/index.jsx',
  'src/index.ts',
  'src/index.js',
  'App.tsx',
  'App.jsx',
  'index.tsx',
  'index.jsx',
];
const DEFAULT_ROUTE_ROOTS = ['src/routes', 'src/pages', 'routes', 'pages'];
const ROUTE_FILE_EXTENSIONS = /\.(tsx|jsx|ts|js|mts|mjs|cts|cjs|html)$/i;
const IGNORED_ROUTE_SEGMENTS = new Set(['layout', '_layout', '__layout', '+layout', 'template', 'error', 'loading', 'not-found']);

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

const stripExecutableBodyMarkup = (html: string): string => {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
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

const readStringArray = (paths: Array<string | null | undefined>): string[] => {
  return paths
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    .map(normalizePath);
};

const parsePackageJson = (content: string | null): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  packageManager?: string;
} | null => {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as {
      dependencies?: unknown;
      devDependencies?: unknown;
      packageManager?: unknown;
    };

    const readDeps = (value: unknown): Record<string, string> => {
      if (!value || typeof value !== 'object') return {};

      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
      );
    };

    return {
      dependencies: readDeps(parsed.dependencies),
      devDependencies: readDeps(parsed.devDependencies),
      packageManager: typeof parsed.packageManager === 'string' ? parsed.packageManager : undefined,
    };
  } catch {
    return null;
  }
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const stripFileExtension = (path: string): string => {
  return path.replace(/\.[^.]+$/, '');
};

const humanizeRouteLabel = (path: string): string => {
  if (path === '/') return 'Home';

  const segments = path.split('/').filter((segment) => segment.length > 0);
  const target = segments[segments.length - 1] ?? path;
  return target
    .replace(/^:/, '')
    .replace(/\*/g, 'Catch-all')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeRouteSegment = (segment: string): string | null => {
  if (!segment || IGNORED_ROUTE_SEGMENTS.has(segment)) {
    return null;
  }

  if (segment === 'index' || segment === 'page' || segment === 'route') {
    return '';
  }

  if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment) || /^\[\.\.\.[^\]]+\]$/.test(segment)) {
    return '*';
  }

  if (/^\[[^\]]+\]$/.test(segment)) {
    return `:${segment.slice(1, -1)}`;
  }

  if (/^\$[A-Za-z0-9_]+$/.test(segment)) {
    return `:${segment.slice(1)}`;
  }

  return segment;
};

const deriveRoutePathFromFile = (filePath: string, root: string): string | null => {
  const relativePath = relativeToDirectory(filePath, root);
  if (relativePath === null || relativePath.length === 0 || !ROUTE_FILE_EXTENSIONS.test(relativePath)) {
    return null;
  }

  const stripped = stripFileExtension(relativePath);
  const rawSegments = stripped.split('/').filter((segment) => segment.length > 0);
  if (rawSegments.length === 0) return '/';

  const normalizedSegments: string[] = [];
  for (const segment of rawSegments) {
    const normalized = normalizeRouteSegment(segment);
    if (normalized === null) return null;
    if (normalized.length === 0) continue;
    normalizedSegments.push(normalized);
  }

  if (normalizedSegments.length === 0) return '/';
  return `/${normalizedSegments.join('/')}`;
};

const extractRoutesFromText = (content: string): string[] => {
  const matches = new Set<string>();
  const patterns = [
    /createFileRoute\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /<Route[^>]*\spath\s*=\s*['"`]([^'"`]+)['"`]/g,
    /\bpath\s*:\s*['"`]([^'"`]+)['"`]/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    match = pattern.exec(content);
    while (match) {
      const routePath = match[1]?.trim();
      if (routePath) {
        matches.add(routePath.startsWith('/') ? routePath : `/${routePath}`);
      }
      match = pattern.exec(content);
    }
  }

  return Array.from(matches);
};

const sortPreviewRoutes = (routes: ContentPreviewRoute[]): ContentPreviewRoute[] => {
  return [...routes].sort((left, right) => {
    if (left.path === right.path) return 0;
    if (left.path === '/') return -1;
    if (right.path === '/') return 1;
    return left.path.localeCompare(right.path);
  });
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
    supportsWorkspaceDescription: true,
    supportsCustomAiWorkspace: true,
    supportsPreviewDescription: true,
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
  private readonly workspaceOptions: Required<ProjectFilesystemWorkspaceOptions>;
  private readonly aiWorkspaceOptions: Required<ProjectFilesystemAiWorkspaceOptions>;
  private readonly previewOptions: {
    mode: 'auto' | ContentPreviewMode;
    appBaseUrl?: string;
    defaultRoute?: string;
    routeDiscovery: Required<ProjectFilesystemRouteDiscoveryOptions>;
  };

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
    this.workspaceOptions = {
      kind: options.workspace?.kind ?? 'auto',
      runtime: options.workspace?.runtime ?? 'auto',
      entryCandidates: [...(options.workspace?.entryCandidates ?? DEFAULT_APP_ENTRY_CANDIDATES)].map(normalizePath),
    };
    this.aiWorkspaceOptions = {
      mode: options.aiWorkspace?.mode ?? 'auto',
      includePageJson: options.aiWorkspace?.includePageJson ?? true,
      includeDerivedHtml: options.aiWorkspace?.includeDerivedHtml ?? true,
      includeComponentScripts: options.aiWorkspace?.includeComponentScripts ?? true,
    };
    this.previewOptions = {
      mode: options.preview?.mode ?? 'auto',
      appBaseUrl: typeof options.preview?.appBaseUrl === 'string' && options.preview.appBaseUrl.trim().length > 0
        ? options.preview.appBaseUrl.trim()
        : undefined,
      defaultRoute: typeof options.preview?.defaultRoute === 'string' && options.preview.defaultRoute.trim().length > 0
        ? options.preview.defaultRoute.trim()
        : undefined,
      routeDiscovery: {
        enabled: options.preview?.routeDiscovery?.enabled ?? true,
        roots: [...(options.preview?.routeDiscovery?.roots ?? DEFAULT_ROUTE_ROOTS)].map(normalizePath),
      },
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

  private async discoverPreviewRoutes(
    files: ContentAdapterFile[],
    descriptor: ContentAdapterWorkspaceDescriptor
  ): Promise<ContentPreviewRoute[]> {
    if (!this.previewOptions.routeDiscovery.enabled || descriptor.runtime !== 'app') {
      return [];
    }

    const routes = new Map<string, ContentPreviewRoute>();
    const visiblePaths = files.map((file) => normalizePath(file.path));

    for (const root of this.previewOptions.routeDiscovery.roots) {
      for (const filePath of visiblePaths) {
        const routePath = deriveRoutePathFromFile(filePath, root);
        if (!routePath || routes.has(routePath)) continue;
        routes.set(routePath, {
          path: routePath,
          label: humanizeRouteLabel(routePath),
          filePath,
        });
      }
    }

    const routerSourceCandidates = visiblePaths.filter((path) => {
      if (!/\.(tsx|jsx|ts|js|mts|mjs|cts|cjs)$/i.test(path)) return false;
      return /(^|\/)(App|app|routes|router|main|entry)\./.test(path);
    });

    for (const path of routerSourceCandidates.slice(0, 12)) {
      const content = await this.readSourceFile(path, {
        source: 'describePreview',
        target: 'route-source',
      });
      if (content === null) continue;

      for (const routePath of extractRoutesFromText(content)) {
        if (routes.has(routePath)) continue;
        routes.set(routePath, {
          path: routePath,
          label: humanizeRouteLabel(routePath),
          filePath: path,
        });
      }
    }

    if (!routes.has('/')) {
      routes.set('/', {
        path: '/',
        label: 'Home',
      });
    }

    return sortPreviewRoutes(Array.from(routes.values()));
  }

  async describeWorkspace(): Promise<ContentAdapterWorkspaceDescriptor> {
    await this.authorize({
      permission: 'list',
      paths: ['*'],
      always: ['*'],
      metadata: { source: 'describeWorkspace' },
    });

    const files = await this.listFilesInternal({ respectGitignore: false });
    const byPath = new Set(files.map((file) => normalizePath(file.path)));
    const resolvedPaths = this.resolvePaths(files);
    this.resolvedPaths = resolvedPaths;

    const packageJson = byPath.has('package.json')
      ? parsePackageJson(await this.readSourceFile('package.json', { source: 'describeWorkspace', target: 'package-json' }))
      : null;

    const dependencyNames = new Set<string>([
      ...Object.keys(packageJson?.dependencies ?? {}),
      ...Object.keys(packageJson?.devDependencies ?? {}),
    ]);

    const hasViteConfig = files.some((file) => /(^|\/)vite\.config\.(ts|js|mts|mjs|cts|cjs)$/.test(file.path));
    const hasSolid = dependencyNames.has('solid-js') || dependencyNames.has('vite-plugin-solid');
    const hasReact = dependencyNames.has('react')
      || dependencyNames.has('react-dom')
      || dependencyNames.has('@vitejs/plugin-react')
      || dependencyNames.has('@vitejs/plugin-react-swc');
    const hasBun = byPath.has('bunfig.toml')
      || (packageJson?.packageManager?.startsWith('bun@') ?? false)
      || dependencyNames.has('bun-types');
    const appEntryPaths = this.workspaceOptions.entryCandidates.filter((path) => byPath.has(path));
    const scriptPaths = files
      .map((file) => file.path)
      .filter((path) => path.startsWith(`${this.scriptsDir}/`) && path.endsWith('.js'))
      .sort((a, b) => a.localeCompare(b));

    let kind: ContentWorkspaceKind;
    if (this.workspaceOptions.kind !== 'auto') {
      kind = this.workspaceOptions.kind;
    } else if (hasViteConfig && hasSolid) {
      kind = 'vite-solid';
    } else if (hasViteConfig && hasReact) {
      kind = 'vite-react';
    } else if (hasViteConfig) {
      kind = 'vite';
    } else if (hasBun && appEntryPaths.length > 0) {
      kind = 'bun-app';
    } else if (resolvedPaths.htmlPath) {
      kind = 'static-html';
    } else if (resolvedPaths.jsxPath || appEntryPaths.length > 0) {
      kind = 'jsx-entry';
    } else if (resolvedPaths.pageJsonPath) {
      kind = 'json-page';
    } else if (files.length > 0) {
      kind = 'filesystem';
    } else {
      kind = 'unknown';
    }

    let runtime: ContentWorkspaceRuntime;
    if (this.workspaceOptions.runtime !== 'auto') {
      runtime = this.workspaceOptions.runtime;
    } else {
      runtime = kind === 'vite'
        || kind === 'vite-react'
        || kind === 'vite-solid'
        || kind === 'bun-app'
        ? 'app'
        : 'page';
    }

    const entryPaths = runtime === 'app'
      ? Array.from(new Set(readStringArray([
        ...appEntryPaths,
        resolvedPaths.htmlPath,
        resolvedPaths.jsxPath,
      ])))
      : Array.from(new Set(readStringArray([
        resolvedPaths.pageJsonPath,
        resolvedPaths.htmlPath,
        resolvedPaths.jsxPath,
      ])));

    return {
      kind,
      runtime,
      entryPaths,
      stylePaths: Array.from(new Set(readStringArray([resolvedPaths.cssPath]))),
      dataPaths: Array.from(new Set(readStringArray([resolvedPaths.pageJsonPath]))),
      scriptPaths,
    };
  }

  async buildAiWorkspace(): Promise<ContentAdapterAiWorkspace> {
    const descriptor = await this.describeWorkspace();
    const visibleFiles = await this.listFilesInternal({ respectGitignore: this.respectGitignore });
    const mode = this.aiWorkspaceOptions.mode === 'auto'
      ? (descriptor.kind === 'json-page' ? 'canonical' : 'files')
      : this.aiWorkspaceOptions.mode === 'project-files'
        ? 'files'
        : 'canonical';

    if (mode === 'files') {
      const files: Record<string, string> = {};
      const editablePaths: string[] = [];
      const readOnlyPaths: string[] = [];

      for (const file of visibleFiles) {
        const content = await this.readSourceFile(file.path, {
          source: 'buildAiWorkspace',
          target: 'project-file',
        });
        if (content === null) continue;

        files[file.path] = content;
        if (file.readOnly) {
          readOnlyPaths.push(file.path);
        } else {
          editablePaths.push(file.path);
        }
      }

      return {
        files,
        editablePaths: editablePaths.sort((a, b) => a.localeCompare(b)),
        readOnlyPaths: readOnlyPaths.sort((a, b) => a.localeCompare(b)),
        mode: 'files',
        descriptor,
      };
    }

    const data = parsePayload(this.snapshot.data);
    const activePage = getActivePage(data);
    const files: Record<string, string> = {};
    const editablePaths: string[] = [];
    const readOnlyPaths: string[] = [];

    if (this.aiWorkspaceOptions.includePageJson) {
      files['page.json'] = JSON.stringify(data, null, 2);
      editablePaths.push('page.json');
    }

    files['styles.css'] = activePage.body.css ?? '';
    editablePaths.push('styles.css');

    if (this.aiWorkspaceOptions.includeDerivedHtml) {
      const currentHtml = new Page(deepClone(activePage)).getHTML();
      const bodyMarkup = extractBodyMarkup(currentHtml);
      files['index.html'] = replaceBodyMarkup('', bodyMarkup, this.resolvedPaths.cssPath ?? 'styles.css', activePage.title || this.defaults.title);
      readOnlyPaths.push('index.html');
    }

    if (this.aiWorkspaceOptions.includeComponentScripts) {
      const scripts: Record<string, string> = {};
      collectScripts(readComponents(activePage), scripts, this.scriptsDir);
      Object.entries(scripts).forEach(([path, script]) => {
        files[path] = script;
        editablePaths.push(path);
      });
    }

    return {
      files,
      editablePaths: Array.from(new Set(editablePaths)).sort((a, b) => a.localeCompare(b)),
      readOnlyPaths: Array.from(new Set(readOnlyPaths)).sort((a, b) => a.localeCompare(b)),
      mode: 'canonical',
      descriptor,
    };
  }

  async describePreview(): Promise<ContentAdapterPreviewDescriptor> {
    const descriptor = await this.describeWorkspace();
    const files = await this.listFilesInternal({ respectGitignore: false });
    const routes = await this.discoverPreviewRoutes(files, descriptor);
    const activePath = this.previewOptions.defaultRoute
      ?? routes[0]?.path
      ?? (descriptor.runtime === 'app' ? '/' : undefined);

    const mode = this.previewOptions.mode === 'auto'
      ? (descriptor.runtime === 'app' && this.previewOptions.appBaseUrl ? 'app-url' : 'page-srcdoc')
      : this.previewOptions.mode;

    const entryUrl = mode === 'app-url' && this.previewOptions.appBaseUrl
      ? this.previewOptions.appBaseUrl
      : undefined;

    return {
      mode,
      kind: descriptor.kind,
      runtime: descriptor.runtime,
      routes,
      activePath,
      baseUrl: entryUrl ? trimTrailingSlash(entryUrl) : undefined,
      entryUrl,
    };
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
        page.body.html = stripExecutableBodyMarkup(extractBodyMarkup(htmlText));
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
