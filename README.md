# EditorTs

DO NOT USE THIS IN PRODUCTION YET. Early development.

EditorTs is a TypeScript library for editing HTML content while keeping the source of truth in clean, portable JSON (components/styles/assets). The editor runtime (toolbars, permissions, UI layout, event handlers) stays in JavaScript.

## Quickstart (run the demo)

```bash
bun install
bun run dev
```

Open `http://localhost:5021`.

The demo UI is `index.html` and is wired by `examples/quickstart.ts`.

## Core concepts

### Data vs runtime config

- JSON (“data”): components, styles/CSS, assets.
- JS (“runtime”): toolbars, UI wiring, event handlers, editor behaviors.

This separation is intentional: the same JSON can be used in different apps with different editor experiences.

### Components-first rendering

When both are present:
- `components` are the source of truth.
- `Page.getHTML()` renders from components.

When only HTML is present:
- HTML can be converted to components when DOM is available.

## Usage

### Minimal init

```ts
import { init, type PageData } from 'editorts'

const editor = init({
  iframeId: 'preview-iframe',
  data: pageData satisfies PageData,
})
```

### Content adapters

EditorTs now supports pluggable content sources via `content.adapter`.

- `data` mode (default): JSON payload (`PageData` or `MultiPageData`)
- `content.adapter` mode: custom source/sink (filesystem, service-backed, etc)

If both are passed, `init()` boots from `data` immediately, then hydrates from `content.adapter.load()`.

```ts
import { init, JsonContentAdapter } from 'editorts'

const editor = init({
  iframeId: 'preview-iframe',
  content: {
    adapter: new JsonContentAdapter(pageData),
  },
})

// Adapter runtime API
await editor.content.load()
await editor.content.save()
```

#### Filesystem adapter (project files)

`ProjectFilesystemAdapter` lets you back the editor from project files (`html`, `css`, `tsx`, etc) by providing an FS bridge.

```ts
import { init, ProjectFilesystemAdapter } from 'editorts'

const adapter = new ProjectFilesystemAdapter({
  fs: {
    listFiles: async () => ['index.html', 'styles.css', 'src/App.tsx'],
    readFile: async (path) => myFsRead(path),
    writeFile: async (path, content) => myFsWrite(path, content),
  },
  loadStrategy: 'auto', // 'auto' | 'page-json' | 'project-files'
  permissions: {
    rules: [
      { permission: 'edit', pattern: 'dist/*', action: 'deny' },
      { permission: 'edit', pattern: '*', action: 'ask' },
    ],
    onRequest: async ({ permission, paths }) => {
      return window.confirm(`Allow ${permission} on ${paths.join(', ')}?`) ? 'once' : 'reject'
    },
  },
  save: {
    writeHtml: true,
    writeCss: true,
    writeComponentScripts: true,
    writePageJson: false,
  },
})

const editor = init({
  iframeId: 'preview-iframe',
  content: { adapter },
})
```

See `docs/content-adapters.md` for architecture details and migration guidance.

### Storage adapters

Local storage is the default, but we recommend SQLocal for persistent, browser-native SQLite storage. SQLocal requires cross-origin isolation headers, so the easiest way is to use the Vite examples in `examples/localsql` or `examples/solid`.

```ts
import { init } from 'editorts'
import { SQLocal } from 'sqlocal'

const sqlocalClient = new SQLocal('editorts.sqlite')

const editor = init({
  iframeId: 'preview-iframe',
  data: pageData,
  storage: {
    type: 'sqlocal',
    client: sqlocalClient,
    // databaseName: 'editorts.sqlite', // when not passing client
  },
})
```

Run the SQLocal demos (Vite):

```bash
cd examples/localsql
bun install
bun run dev
```

```bash
cd examples/solid
bun install
bun run dev
```

Open `http://localhost:5173`.

Run filesystem-backed Solid demo:

```bash
cd examples/filesystem-solid
bun install
bun run dev
```

Open `http://localhost:5173` and use either:

- **Open Folder** (browser File System Access API), or
- **Server Routes** mode for host/VM/container filesystem access via `/api/fs/*`.

### Toolbars (runtime only)

```ts
import { init } from 'editorts'

const editor = init({
  iframeId: 'preview-iframe',
  data: pageData,
  toolbars: {
    byId: {
      header: {
        enabled: true,
        actions: [
          { id: 'edit', label: 'Edit', icon: '✏️', enabled: true },
          { id: 'duplicate', label: 'Duplicate', icon: '📋', enabled: true },
        ],
      },
    },
  },
})
```

### UI containers (you own the layout)

EditorTs does not create your sidebar/tabs/layout. You provide containers and `init()` wires them.

```ts
const editor = init({
  iframeId: 'preview-iframe',
  data: pageData,
  ui: {
    stats: { containerId: 'stats-container' },
    layers: { containerId: 'layers-container' },
    selectedInfo: { containerId: 'selected-info' },
    viewTabs: {
      editorButtonId: 'tab-editor',
      codeButtonId: 'tab-code',
      defaultView: 'editor',
    },
    editors: {
      js: { containerId: 'js-editor-container' },
      css: { containerId: 'css-editor-container' },
      json: { containerId: 'json-editor-container' },
      jsx: { containerId: 'jsx-editor-container' },
    },
  },
})
```

## Built-in code editors

EditorTs can render editors into your containers:

- Default: `textarea` (zero deps)
- Optional: `modern-monaco` (syntax highlighting)

```ts
const editor = init({
  iframeId: 'preview-iframe',
  data: pageData,
  codeEditor: { provider: 'modern-monaco' },
})
```

Notes:
- `modern-monaco` is an optional peer dependency.
- `typescript` is an optional peer dependency (used for TSX/JSX parsing).

## Component conversions

### Components → HTML

```ts
const html = editor.page.components.toHTML()
```

### HTML → Components

```ts
// Requires DOM (browser). Server-side: inject an adapter or it will warn and no-op.
editor.page.components.setFromHTML('<body><div id="root">Hello</div></body>')
```

### Components → JSX/TSX

```ts
const jsxSource = editor.page.components.toJSX({ pretty: true })
```

`toJSX()` outputs React-style function components named from `attributes.id` when possible.

### JSX/TSX → Components

```ts
// Uses optional peer dependency `typescript`.
await editor.page.components.setFromJSX(`
export function Header() {
  return <div id="header">Hello</div>
}
`)
```

## Server sync (Bun + Cloudflare)

EditorTs ships lightweight websocket utilities for server-side sync.

### Bun server

```ts
import { createBunSyncServer, createSyncMessage } from 'editorts'

const server = createBunSyncServer({
  port: 8787,
  onSync: async (message) => {
    console.log('received', message.payload)
  },
})

// elsewhere, send a message
const payload = createSyncMessage(pageData)
```

### Cloudflare worker

```ts
import { createCfSyncWorker } from 'editorts'

export default createCfSyncWorker({
  onSync: async (message) => {
    console.log('received', message.payload)
  },
})
```

### Message helpers

```ts
import { createSyncMessage, parseSyncEnvelope } from 'editorts'

const message = createSyncMessage(pageData)
const parsed = parseSyncEnvelope(JSON.stringify(message))
```

## AI provider (OpenCode)

Optional integration via `@opencode-ai/sdk`.

```ts
import { createOpencodeClient } from '@opencode-ai/sdk'

const editor = init({
  iframeId: 'preview-iframe',
  data: pageData,
  aiProvider: {
    provider: 'opencode',
    mode: 'client',
    baseUrl: 'http://localhost:4096',

    // Optional: pass your own client
    client: createOpencodeClient({ baseUrl: 'http://localhost:4096' }),
  },
})

// Later
const client = await editor.ai?.getClient()
```

## Events

The editor emits typed events:

- `componentSelect`
- `componentEdit`, `componentEditJS`
- `componentDuplicate`, `componentDelete`
- `componentReorder`
- `pageEditCSS`, `pageEditJSON`
- `pageSaved`, `pageLoaded`

See `src/types.ts` for the full event map.

## Development

```bash
bun run build
bun run test
```

## Migration notes (`data` -> `content.adapter`)

1. Keep your existing `data` flow first (no behavior change).
2. Introduce an adapter that can `load()` and `save()` your canonical snapshot.
3. Pass `content: { adapter }` to `init()`.
4. Keep runtime editor config in JS (`toolbars`, `ui`, handlers) - never in persisted data/files.
5. Use `editor.content.load()` / `editor.content.save()` for adapter-driven sync points.

The existing `storage` option remains separate from `content.adapter`:

- `content.adapter`: where editor content comes from (JSON/filesystem/custom source)
- `storage`: where editor snapshots/version state are persisted

## Project map

- Core entry: `src/core/init.ts`
- Page model: `src/core/Page.ts`
- Data managers: `src/core/ComponentManager.ts`, `src/core/StyleManager.ts`, `src/core/AssetManager.ts`
- Storage: `src/core/StorageManager.ts`
- Content adapters: `src/core/JsonContentAdapter.ts`, `src/core/ProjectFilesystemAdapter.ts`
- Demo: `index.html` + `examples/quickstart.ts`
- Architecture + workflow: `AGENTS.md`
