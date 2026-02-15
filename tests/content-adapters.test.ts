import { describe, expect, it } from 'bun:test';
import { JsonContentAdapter } from '../src/core/JsonContentAdapter';
import {
  ProjectFilesystemAdapter,
  type ProjectFilesystemProvider,
} from '../src/core/ProjectFilesystemAdapter';
import type { MultiPageData, PageData, PagePayload } from '../src/types';

const parsePayload = (payload: PagePayload): PageData | MultiPageData => {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as PageData | MultiPageData;
  }
  return payload;
};

const getActivePage = (payload: PagePayload): PageData => {
  const parsed = parsePayload(payload);
  if ('pages' in parsed) {
    return parsed.pages[parsed.activePageIndex ?? 0] ?? parsed.pages[0]!;
  }
  return parsed;
};

const createMemoryFs = (seed: Record<string, string>): {
  provider: ProjectFilesystemProvider;
  files: Map<string, string>;
} => {
  const files = new Map<string, string>(Object.entries(seed));

  const provider: ProjectFilesystemProvider = {
    listFiles: async () => Array.from(files.keys()).sort((a, b) => a.localeCompare(b)),
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, content: string) => {
      files.set(path, content);
    },
  };

  return { provider, files };
};

describe('content adapters', () => {
  it('JsonContentAdapter lists virtual files and marks derived html read-only', async () => {
    const adapter = new JsonContentAdapter({
      title: 'JSON Adapter',
      item_id: 1,
      body: {
        components: [
          {
            type: 'box',
            attributes: { id: 'hero' },
            script: 'console.log("hero");',
          },
        ],
        css: 'body { color: #111; }',
        styles: [],
        assets: [],
      },
    });

    const files = await adapter.listFiles();

    expect(files.some((file) => file.path === 'page.json')).toBe(true);
    expect(files.some((file) => file.path === 'styles.css')).toBe(true);
    expect(files.some((file) => file.path === 'components/hero.js')).toBe(true);
    expect(files.some((file) => file.path === 'index.html' && file.readOnly === true)).toBe(true);
  });

  it('JsonContentAdapter writeFile updates snapshot data', async () => {
    const adapter = new JsonContentAdapter({
      title: 'JSON Adapter',
      item_id: 1,
      body: {
        components: [
          {
            type: 'box',
            attributes: { id: 'hero' },
            script: 'console.log("old");',
          },
        ],
        css: '',
        styles: [],
        assets: [],
      },
    });

    await adapter.writeFile('styles.css', 'body { color: red; }');
    await adapter.writeFile('components/hero.js', 'console.log("new");');

    const snapshot = await adapter.load();
    const page = getActivePage(snapshot.data);
    const components = Array.isArray(page.body.components)
      ? page.body.components
      : JSON.parse(page.body.components ?? '[]');

    expect(page.body.css).toBe('body { color: red; }');
    expect(components[0]?.script).toBe('console.log("new");');
  });

  it('ProjectFilesystemAdapter loads from page.json when strategy is page-json', async () => {
    const pageJson = JSON.stringify({
      title: 'From JSON',
      item_id: 44,
      body: {
        html: '<section id="root">json</section>',
        components: [],
        css: 'body { margin: 0; }',
        styles: [],
        assets: [],
      },
    });

    const { provider } = createMemoryFs({
      'page.json': pageJson,
      'styles.css': 'body { color: green; }',
      'index.html': '<!DOCTYPE html><html><body>ignored</body></html>',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      loadStrategy: 'page-json',
    });

    const snapshot = await adapter.load();
    const page = getActivePage(snapshot.data);

    expect(page.title).toBe('From JSON');
    expect(page.item_id).toBe(44);
    expect(page.body.css).toContain('margin');
  });

  it('ProjectFilesystemAdapter loads from html/css when strategy is project-files', async () => {
    const { provider } = createMemoryFs({
      'index.html': '<!DOCTYPE html><html><head><title>Project Title</title></head><body><main id="app">hello</main></body></html>',
      'styles.css': 'main { color: blue; }',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      loadStrategy: 'project-files',
    });

    const snapshot = await adapter.load();
    const page = getActivePage(snapshot.data);

    expect(page.title).toBe('Project Title');
    expect(page.body.html).toBe('<main id="app">hello</main>');
    expect(page.body.css).toBe('main { color: blue; }');
  });

  it('ProjectFilesystemAdapter auto mode prefers project files over page.json', async () => {
    const pageJson = JSON.stringify({
      title: 'From JSON',
      item_id: 44,
      body: {
        html: '<section>json-only</section>',
        components: [],
        css: 'body { color: red; }',
        styles: [],
        assets: [],
      },
    });

    const { provider } = createMemoryFs({
      'page.json': pageJson,
      'index.html': '<!DOCTYPE html><html><head><title>From HTML</title></head><body><main>html-source</main></body></html>',
      'styles.css': 'main { color: blue; }',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      loadStrategy: 'auto',
    });

    const snapshot = await adapter.load();
    const page = getActivePage(snapshot.data);

    expect(page.title).toBe('From HTML');
    expect(page.body.html).toBe('<main>html-source</main>');
    expect(page.body.css).toBe('main { color: blue; }');
  });

  it('ProjectFilesystemAdapter listFiles respects .gitignore patterns', async () => {
    const { provider } = createMemoryFs({
      '.gitignore': [
        'dist',
        'node_modules',
        '*.log',
        '!important.log',
        'src/generated/',
        'apps/web/build',
      ].join('\n'),
      'index.html': '<!DOCTYPE html><html><body><main>hello</main></body></html>',
      'styles.css': 'main { color: blue; }',
      'src/main.ts': 'export const main = true;',
      'dist/app.js': 'console.log("ignore");',
      'node_modules/pkg/index.js': 'console.log("ignore module");',
      'packages/ui/node_modules/widget/index.js': 'console.log("ignore nested module");',
      'debug.log': 'ignore me',
      'important.log': 'keep me',
      'src/generated/file.ts': 'ignore generated',
      'apps/web/build/main.js': 'ignore build output',
      'apps/web/build-info.txt': 'keep this file',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      loadStrategy: 'project-files',
    });

    const files = await adapter.listFiles();
    const paths = files.map((file) => file.path);

    expect(paths).toContain('.gitignore');
    expect(paths).toContain('index.html');
    expect(paths).toContain('styles.css');
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('important.log');
    expect(paths).toContain('apps/web/build-info.txt');

    expect(paths).not.toContain('dist/app.js');
    expect(paths).not.toContain('node_modules/pkg/index.js');
    expect(paths).not.toContain('packages/ui/node_modules/widget/index.js');
    expect(paths).not.toContain('debug.log');
    expect(paths).not.toContain('src/generated/file.ts');
    expect(paths).not.toContain('apps/web/build/main.js');
  });

  it('ProjectFilesystemAdapter load ignores .gitignore filtering for source detection', async () => {
    const { provider } = createMemoryFs({
      '.gitignore': 'index.html',
      'index.html': '<!DOCTYPE html><html><head><title>Hidden Source</title></head><body><main id="root">hidden</main></body></html>',
      'styles.css': 'main { color: blue; }',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      loadStrategy: 'project-files',
    });

    const listed = await adapter.listFiles();
    expect(listed.map((file) => file.path)).not.toContain('index.html');

    const snapshot = await adapter.load();
    const page = getActivePage(snapshot.data);
    expect(page.title).toBe('Hidden Source');
    expect(page.body.html).toBe('<main id="root">hidden</main>');
  });

  it('ProjectFilesystemAdapter denies blocked edit permissions', async () => {
    const { provider } = createMemoryFs({
      'styles.css': 'body { color: black; }',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      permissions: {
        rules: [
          { permission: 'edit', pattern: 'styles.css', action: 'deny' },
        ],
      },
    });

    await expect(adapter.writeFile('styles.css', 'body { color: red; }')).rejects.toThrow(
      'permission denied'
    );
  });

  it('ProjectFilesystemAdapter supports ask->always permission escalation', async () => {
    const { provider } = createMemoryFs({
      'styles.css': 'body { color: black; }',
    });

    let requestCount = 0;

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      permissions: {
        defaultAction: 'allow',
        rules: [
          { permission: 'read', pattern: 'styles.css', action: 'ask' },
        ],
        onRequest: async () => {
          requestCount += 1;
          return 'always' as const;
        },
      },
    });

    const first = await adapter.readFile('styles.css');
    const second = await adapter.readFile('styles.css');

    expect(first).toContain('black');
    expect(second).toContain('black');
    expect(requestCount).toBe(1);
  });

  it('ProjectFilesystemAdapter requests external_directory for escaping paths', async () => {
    const { provider } = createMemoryFs({
      '../secret.txt': 'outside project root',
    });

    const requestedPermissions: string[] = [];

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      permissions: {
        defaultAction: 'allow',
        rules: [
          { permission: 'external_directory', pattern: '*', action: 'ask' },
          { permission: 'read', pattern: '*', action: 'allow' },
        ],
        onRequest: async (request) => {
          requestedPermissions.push(request.permission);
          return 'once' as const;
        },
      },
    });

    const content = await adapter.readFile('../secret.txt');

    expect(content).toBe('outside project root');
    expect(requestedPermissions).toEqual(['external_directory']);
  });

  it('ProjectFilesystemAdapter save writes html/css/component scripts', async () => {
    const { provider, files } = createMemoryFs({
      'index.html': '<!DOCTYPE html><html><head><title>Old</title></head><body><div>old</div></body></html>',
      'styles.css': 'body { color: black; }',
    });

    const adapter = new ProjectFilesystemAdapter({
      fs: provider,
      loadStrategy: 'project-files',
      save: {
        writePageJson: false,
        writeHtml: true,
        writeCss: true,
        writeComponentScripts: true,
      },
    });

    const page: PageData = {
      title: 'Saved Project',
      item_id: 91,
      body: {
        components: [
          {
            type: 'box',
            attributes: { id: 'hero' },
            content: 'Hello',
            script: 'console.log("hero");',
          },
        ],
        css: 'body { background: white; }',
        styles: [],
        assets: [],
      },
    };

    await adapter.save({ data: page });

    expect(files.get('styles.css')).toBe('body { background: white; }');
    expect(files.get('components/hero.js')).toBe('console.log("hero");');
    expect(files.get('page.json')).toBeUndefined();

    const html = files.get('index.html') ?? '';
    expect(html).toContain('<body>');
    expect(html).toContain('hero');
  });
});
