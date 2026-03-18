# EditorTs

DO NOT USE THIS IN PRODUCTION YET. Early development.

EditorTs is a TypeScript library for editing HTML content while keeping the source of truth in clean, portable JSON (components/styles/assets). The editor runtime (toolbars, permissions, UI layout, event handlers) stays in JavaScript.

## Quickstart (run the demo)

```bash
bun install
bun run dev
```

Open `http://localhost:5021`.

The demo UI is `index.html` and is wired by `packages/quickstart/src/main.ts`.

Root workspace commands:

- `bun run dev`: quickstart/local server
- `bun run dev:web`: web starter
- `bun run dev:desktop`: desktop/filesystem browser renderer
- `bun run dev:desktop:native`: Electrobun desktop shell + desktop renderer
- `bun run dev:desktop:native:ai`: Electrobun desktop shell + desktop renderer + OpenCode
- `bun run dev:localsql`: SQLocal starter
- `bun run build`: build the full workspace
- `bun run build:desktop`: build the desktop renderer and native Electrobun package
- `bun run build:desktop:web`: build only the desktop renderer
- `bun run build:desktop:native`: build only the native Electrobun package
- `bun run install:desktop:local`: build and run the Linux local desktop installer
- `bun run test`: run package-oriented tests

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

#### Remote project files over HTTP

If your hosted app needs to read and write project files through your own API (database, bucket, repo bridge, etc), pair `ProjectFilesystemAdapter` with `createHttpProjectProvider`.

```ts
import {
  init,
  createHttpProjectProvider,
  ProjectFilesystemAdapter,
} from 'editorts'

const fs = createHttpProjectProvider({
  baseUrl: 'https://api.example.com/project',
  headers: async () => ({
    Authorization: `Bearer ${await getToken()}`,
  }),
})

const editor = init({
  iframeId: 'preview-iframe',
  content: {
    adapter: new ProjectFilesystemAdapter({
      fs,
      loadStrategy: 'auto',
      save: {
        writeHtml: true,
        writeCss: true,
        writeComponentScripts: true,
      },
    }),
  },
})
```

Default HTTP contract:

- `GET /files` -> `{ files: Array<string | { path, readOnly?, language? }> }`
- `GET /files/:path` -> `{ content: string | null }` (or raw text)
- `PUT /files/:path` with `{ content }`

### Storage adapters

Local storage is the default, but we recommend SQLocal for persistent, browser-native SQLite storage. SQLocal requires cross-origin isolation headers, so the easiest way is to use the Vite workspace apps in `packages/localsql` or `packages/web`.

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
cd packages/localsql
bun run dev
```

```bash
cd packages/web
bun run dev
```

Open `http://localhost:5173` for `packages/localsql`, or `http://localhost:2022` for `packages/web`.

Run filesystem-backed Solid demo:

```bash
cd packages/desktop
bun run dev
```

Open `http://localhost:2050` and use either:

- **Open Folder** (browser File System Access API), or
- **Server Routes** mode for host/VM/container filesystem access via `/api/fs/*`.

Electrobun desktop shell:

```bash
bun run dev:desktop:native
```

Install the desktop app locally on Linux:

```bash
bun run install:desktop:local
```

The Electrobun path is being introduced incrementally. It uses Bun in the main
process, uses Electrobun RPC for native desktop calls, and initializes desktop
app state in SQLite under the native user-data directory. Native project picks are
stored as recent projects and the last connected native project is restored on launch.
Packaged desktop builds load bundled renderer assets from `views://index.html`;
only dev mode relies on the local Vite renderer URL. The desktop renderer also
stubs out SQLocal so browser OPFS SQLite assets do not ship in the native app.
Desktop boots in a lighter mode first and upgrades AI/code tooling on first use,
and AI working-directory changes now apply without forcing a full editor re-init.

Desktop build commands:

```bash
bun run build:desktop
```

For renderer-only or native-only output:

```bash
bun run build:desktop:web
bun run build:desktop:native
```

`build:desktop:native` runs the desktop renderer prebuild automatically, so the
packaged Electrobun app always includes fresh bundled `views/` assets.

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
    directory: '/absolute/path/to/project',

    // Optional: pass your own client
    client: createOpencodeClient({ baseUrl: 'http://localhost:4096' }),
  },
})

// Later
const client = await editor.ai?.getClient()
```

For hosted apps that connect to a user-local OpenCode server, run the server with CORS enabled for your app origin:

```bash
opencode serve --port 4096 --cors https://your-app.example.com
```

EditorTs uses the OpenCode SDK's fetch + event-stream subscription model for streaming chat output. It does not open a direct WebSocket for AI chat.

When you need OpenCode sessions to run against a specific local project, pass
`aiProvider.directory` so the client forwards `x-opencode-directory` to the server.

For the full hosted + local-files workflow, recommend Chromium browsers because folder access depends on the File System Access API.

## Events

The editor emits typed events:

- `componentSelect`
- `componentEdit`, `componentEditJS`
- `componentDuplicate`, `componentDelete`
- `componentReorder`
- `pageEditCSS`, `pageEditJSON`
- `pageSaved`, `pageLoaded`

See `core/src/types.ts` for the full event map.

## Development

```bash
bun install
bun run build
bun run test
```

Workspace layout:

- `core/`: the `editor-ts` library package
- `packages/web`: web starter
- `packages/desktop`: desktop/filesystem starter
- `packages/desktop/src/bun`: Electrobun native shell entry + desktop SQLite bootstrap
- `packages/localsql`: SQLocal starter
- `packages/quickstart`: root quickstart wiring and quickstart-owned assets
- `packages/starter-shared`: shared starter UI/runtime helpers

Common workspace commands:

- `bun run build`: build `core`, `packages/web`, `packages/desktop`, and `packages/localsql`
- `bun run build:core`: build only the library package
- `bun run dev`: run the root quickstart
- `bun run test`: run `core` and `packages/web` tests

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

- Core entry: `core/src/core/init.ts`
- Page model: `core/src/core/Page.ts`
- Data managers: `core/src/core/ComponentManager.ts`, `core/src/core/StyleManager.ts`, `core/src/core/AssetManager.ts`
- Storage: `core/src/core/StorageManager.ts`
- Content adapters: `core/src/core/JsonContentAdapter.ts`, `core/src/core/ProjectFilesystemAdapter.ts`
- Demo: `index.html` + `packages/quickstart/src/main.ts`
- Library tests: `core/tests/*.test.ts`
- Web starter tests: `packages/web/tests/*.test.ts`
- Architecture + workflow: `AGENTS.md`
