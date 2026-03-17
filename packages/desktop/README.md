# EditorTs Desktop

This package currently contains two desktop-facing paths:

- a browser/Vite renderer used during the existing migration
- an Electrobun native shell scaffold that will become the long-term desktop runtime

The renderer runs EditorTs in a SolidJS app with a filesystem-backed content adapter.

It supports two filesystem access modes:

- Browser Folder mode (File System Access API)
- Server Routes mode (`/api/fs/*` HTTP endpoints)

For AI/OpenCode integration, the desktop starter also exposes an **AI Working Directory**
field. OpenCode needs a real absolute project path for session/workspace scoping.

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

Browser renderer only:

```bash
bun run dev
```

Open `http://localhost:2050`.

Electrobun native shell:

```bash
bun run dev:native
```

Or from the repo root:

```bash
bun run dev:desktop:native
```

Native packaging build:

```bash
bun run build
```

If you only want one half of the desktop target:

```bash
bun run build:web
bun run build:native
```

Electrobun app state is initialized with SQLite in the native app-data directory
via `Utils.paths.userData`, using `editorts-desktop.sqlite`.

In native mode, the Electrobun main process also starts a desktop API bridge that the
renderer uses for:

- native folder picking
- filesystem reads/writes
- persisted desktop settings (`aiBaseUrl`, `aiDirectory`, `previewBaseUrl`, `lastProjectRoot`)
- recent-project tracking
- automatic restore of the last connected native project

## Browser support

Use a browser with File System Access API support (latest Chrome/Edge).

If your browser does not support it, use **Server Routes** mode.

## Usage flow

### Browser Folder mode

1. Select **Browser Folder**.
2. Click **Open Folder**.
3. Pick a project folder.
4. If you want OpenCode to operate on that same project, fill in **AI Working Directory**
   with the real absolute path manually.
5. Edit in canvas or code tabs.

### Native folder flow (Electrobun)

1. Start the native shell with `bun run dev:native` or `bun run dev:desktop:native`.
2. Click **Open Native Folder**.
3. Pick a real project directory through the native dialog.
4. EditorTs switches to the native filesystem bridge automatically.
5. The selected project is stored in desktop SQLite and appears in **Recent projects**.
6. OpenCode can use the selected absolute project path as its AI working directory.
7. On the next native launch, EditorTs attempts to restore the last connected native project automatically.

### Server Routes mode

1. Select **Server Routes**.
2. Set API base URL (defaults to current origin).
3. Set project root path on the host filesystem.
4. Click **Connect Routes**.
5. The starter will reuse that root as the default **AI Working Directory**.
6. Edit in canvas or code tabs.

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

The Electrobun native shell runs its own local desktop API instead of the Vite-only
filesystem routes. That native API is what enables absolute-path project selection and
SQLite-backed desktop settings and recent-project restore.

If the native app looks too zoomed in or too small on your platform, override the
desktop webview zoom factor:

```bash
EDITORTS_DESKTOP_ZOOM=0.9 bun run dev:native
```
