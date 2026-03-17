# EditorTs Filesystem + Solid (Vite)

This demo runs EditorTs in a SolidJS app with a filesystem-backed content adapter.

It supports two filesystem access modes:

- Browser Folder mode (File System Access API)
- Server Routes mode (`/api/fs/*` HTTP endpoints)

## What it demonstrates

- `ProjectFilesystemAdapter` as editor content source
- Browser File System Access API (`showDirectoryPicker`)
- Server route provider (`/api/fs/list`, `/api/fs/read`, `/api/fs/write`)
- Real file reads/writes for `index.html`, `styles.css`, and related project files
- Adapter-driven files panel and AI file-path guardrails

## Setup

```bash
cd packages/desktop
bun install
```

## Run

```bash
bun run dev
```

Open `http://localhost:2050`.

## Browser support

Use a browser with File System Access API support (latest Chrome/Edge).

If your browser does not support it, use **Server Routes** mode.

## Usage flow

### Browser Folder mode

1. Select **Browser Folder**.
2. Click **Open Folder**.
3. Pick a project folder.
4. Edit in canvas or code tabs.

### Server Routes mode

1. Select **Server Routes**.
2. Set API base URL (defaults to current origin).
3. Set project root path on the host filesystem.
4. Click **Connect Routes**.
5. Edit in canvas or code tabs.

## Server route contract

The demo adds these endpoints in `vite.config.ts`:

- `GET /api/fs/list?root=<absolutePath>` -> `{ files: string[] }`
- `GET /api/fs/read?root=<absolutePath>&path=<relativePath>` -> `{ content: string | null }`
- `POST /api/fs/write` with `{ root, path, content }` -> `{ ok: true }`

For safety, requested root paths must be under allowed directories.

- Default allowed root: current `packages/desktop` working directory
- Override with env var:

```bash
FS_DEMO_ALLOWED_ROOTS="/path/a:/path/b" bun run dev
```
