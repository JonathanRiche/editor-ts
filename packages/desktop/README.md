# EditorTs Desktop

This package contains:

- a browser/Vite renderer for filesystem and hosted testing
- an Electrobun native desktop runtime for real local project access

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
bun install
cd packages/desktop
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

Open the native desktop app directly to a project path:

```bash
verde -p /absolute/path/to/project
```

Supported forms:

```bash
verde --project /absolute/path/to/project
verde --project=/absolute/path/to/project
```

When a project path is passed at startup, the desktop app opens that project
before falling back to the last restored native workspace.

Native packaging build:

```bash
bun run build
```

Local install on Linux:

```bash
bun run install:local
```

That command builds the stable package, extracts the generated `*-Setup.tar.gz`
installer from `artifacts/`, runs the embedded installer for you, creates a
`Verde.desktop` launcher under `~/.local/share/applications`, and exposes a
`bin/Verde` executable alias inside the installed app bundle.

Electrobun still hardcodes the internal Linux bundle launcher as `launcher`.
The local install script adds the app-named alias and desktop entry on top so
the launcher path looks like `.../bin/Verde` in normal use.

`bun run build:native` also runs the renderer prebuild automatically, so packaged
desktop output always includes the latest copied `views/` assets.

If you only want one half of the desktop target:

```bash
bun run build:web
bun run build:native
```

Electrobun app state is initialized with SQLite in the native app-data directory
via `Utils.paths.userData`, using `editorts-desktop.sqlite`.

The desktop renderer does not ship SQLocal or OPFS SQLite worker assets. Desktop
state stays on the native Bun/SQLite side instead of pulling the browser storage
stack into the packaged app.

The desktop starter also boots in a lighter editor mode first. AI chat wiring and
code-workspace panels are upgraded on first use when you open the `Chat` or `Code`
tabs, instead of paying that setup cost on initial launch.

In native mode, the Electrobun main process exposes desktop functionality over
Electrobun RPC. The renderer uses that native RPC path for:

- native folder picking
- filesystem reads/writes
- persisted desktop settings (`aiBaseUrl`, `aiDirectory`, `previewBaseUrl`, `lastProjectRoot`)
- recent-project tracking
- automatic restore of the last connected native project

Desktop keyboard shortcuts are resolved from a user config file at
`~/.config/verde/verde.json` (or `$XDG_CONFIG_HOME/verde/verde.json` when set).
The desktop app starts with built-in defaults and lets users override them under
the `keybinds` object:

```json
{
  "keybinds": {
    "modKey": "default",
    "refresh": ["<Mod-r>", "<Mod-S-r>", "<F5>"],
    "toggleDevTools": "<Mod-S-i>"
  }
}
```

Config uses Vim-style key notation. Examples: `<Mod-r>`, `<C-r>`, `<D-r>`,
`<M-Enter>`, `<S-Tab>`, `<F5>`.

`modKey` controls what `<Mod-...>` expands to. Supported values are `default`,
`ctrl`, `cmd`, `alt`, and `super`. `default` maps to `cmd` on macOS and `ctrl`
everywhere else.

Set a shortcut to `null`, `""`, or `[]` to disable that action entirely. Legacy
accelerator strings like `CommandOrControl+R` are still accepted for compatibility.

Changing the AI working directory no longer forces a full editor rebuild. New AI
requests pick up the latest configured path through a live resolver in the library.

Packaged native builds use the bundled renderer assets copied into `views/`.
Only development mode depends on the local Vite URL.

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
4. EditorTs switches to the native filesystem RPC provider automatically.
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

The Electrobun native shell bypasses the Vite-only filesystem HTTP routes for native
operations. Absolute-path project selection, real file IO, and SQLite-backed desktop
state all go through the native RPC path instead.

If the native app looks too zoomed in or too small on your platform, override the
desktop webview zoom factor:

```bash
EDITORTS_DESKTOP_ZOOM=0.9 bun run dev:native
```

If the native wrapper ignores that zoom change, use the renderer-level desktop UI
scale instead:

```bash
EDITORTS_DESKTOP_UI_SCALE=0.8 bun run dev:native
```
