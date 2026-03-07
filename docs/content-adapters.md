# Content Adapters

This document explains EditorTs content adapters and how they differ from storage adapters.

## Why this exists

EditorTs separates three concerns:

- Data model: content structure (`components`, `styles/css`, `assets`, html fallback)
- Runtime behavior: editor UI, toolbars, events, permissions
- Persistence backend: where snapshots/history are stored

Content adapters handle only the first concern: how content is loaded/saved and represented as files.

## Contracts

`ContentAdapter` is defined in `src/types.ts` and includes:

- `load()` and `save(snapshot)`
- `listFiles()`, `readFile(path)`, `writeFile(path, content)`
- `capabilities` metadata (`supportsFileTree`, `writable`, etc)

All adapters exchange data through `EditorContentSnapshot`:

- `snapshot.data`: canonical `PagePayload`
- `snapshot.files` (optional): file metadata for UI/AI tools

## Built-in adapters

### `JsonContentAdapter` (default)

- Source of truth is standard `PagePayload` JSON.
- Exposes virtual workspace files:
  - `page.json`
  - `styles.css`
  - `index.html` (derived, read-only)
  - `components/<id>.js`
- Keeps existing components-first behavior.

### `ProjectFilesystemAdapter`

- Source of truth is project files via injected file provider callbacks.
- Supports load strategies:
  - `page-json`: prefer `page.json`
  - `project-files`: prefer html/css/jsx project sources
  - `auto`: uses project files when present, otherwise `page.json`
- Supports save controls for html/css/component scripts/page.json.
- Supports runtime file permissions (`list`, `read`, `edit`, `external_directory`) via
`permissions.rules` + optional `permissions.onRequest` callback.

### HTTP-backed project files

If your project files live behind your own HTTP API, use `createHttpProjectProvider()` with `ProjectFilesystemAdapter`.

```ts
import {
  createHttpProjectProvider,
  ProjectFilesystemAdapter,
} from 'editorts'

const fs = createHttpProjectProvider({
  baseUrl: 'https://api.example.com/project',
  headers: {
    Authorization: 'Bearer <token>',
  },
})

const adapter = new ProjectFilesystemAdapter({
  fs,
  loadStrategy: 'auto',
  save: {
    writeHtml: true,
    writeCss: true,
    writeComponentScripts: true,
  },
})
```

Default HTTP contract:

- `GET /files` -> `{ files: Array<string | { path, readOnly?, language? }> }`
- `GET /files/:path` -> `{ content: string | null }` (or raw text)
- `PUT /files/:path` with `{ content }`

Example:

```ts
const adapter = new ProjectFilesystemAdapter({
  fs,
  permissions: {
    rules: [
      { permission: 'edit', pattern: 'dist/*', action: 'deny' },
      { permission: 'read', pattern: '*', action: 'allow' },
      { permission: 'edit', pattern: '*', action: 'ask' },
    ],
    onRequest: async (request) => {
      // your UI can decide once/always/reject
      return window.confirm(`Allow ${request.permission} on ${request.paths.join(', ')}?`)
        ? 'once'
        : 'reject';
    },
  },
});
```

## Runtime wiring (`init`)

`init()` accepts either:

- `data` (legacy/default path), or
- `content: { adapter }`

When adapter mode is used, `EditorTsEditor` exposes:

- `editor.content.adapter`
- `editor.content.load()`
- `editor.content.save()`

## AI and files panel behavior

- Files panel now reads file lists/content from `contentAdapter`.
- AI prompt snapshots now come from adapter files, not hardcoded JSON paths.
- AI replacements are path-guarded to adapter-editable files.

## Migration checklist

1. Keep current `data` flow and runtime config unchanged.
2. Introduce an adapter implementation that maps your source to `EditorContentSnapshot`.
3. Pass adapter with `content: { adapter }`.
4. Verify file list/read/write behavior in code tabs.
5. Verify AI replacement path restrictions match your adapter permissions.
6. Keep editor runtime settings in JS config, never persisted into content files.

## Notes

- `content.adapter` and `storage` are complementary:
  - adapter = content source model
  - storage = snapshot/history persistence
- Prefer adding capabilities metadata so UI/AI can adapt cleanly.
