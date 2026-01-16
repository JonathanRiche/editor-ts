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

### Storage adapters

Local storage is the default. To use SQLite in the browser via OPFS, install the optional `sqlocal` peer dependency and configure the storage adapter:

```ts
import { init } from 'editorts'

const editor = init({
  iframeId: 'preview-iframe',
  data: pageData,
  storage: {
    type: 'sqlocal',
    databaseName: 'editorts.sqlite',
  },
})
```

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

## Project map

- Core entry: `src/core/init.ts`
- Page model: `src/core/Page.ts`
- Data managers: `src/core/ComponentManager.ts`, `src/core/StyleManager.ts`, `src/core/AssetManager.ts`
- Storage: `src/core/StorageManager.ts`
- Demo: `index.html` + `examples/quickstart.ts`
- Architecture + workflow: `AGENTS.md`
