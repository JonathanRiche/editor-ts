# EditorTs Solid Hosted Demo

This is the main showcase app for EditorTs.

It combines:

- a hosted SolidJS shell
- SQLocal persistence for review/demo mode
- optional local folder access from Chromium browsers
- optional direct connection to a local OpenCode server for AI-assisted edits

## Setup

```bash
cd examples/solid
bun install
```

## Run locally

```bash
bun run dev
```

Open `http://localhost:5173`.

## What to test

### Hosted review mode

- Load the app
- Edit the demo page visually
- Refresh the browser
- Confirm the SQLocal-backed demo state persists

### Local folder mode

- Use Chromium
- Click `Connect Folder`
- Pick a project folder
- Edit in canvas or code tabs
- Confirm real files update on disk

### Local OpenCode mode

Start OpenCode on the same machine as the browser:

```bash
opencode serve --port 4096 --cors http://localhost:5173 --cors http://127.0.0.1:5173
```

Then in the app:

- set `OpenCode base URL` to `http://127.0.0.1:4096`
- click `Check health`
- send a prompt in the AI panel
- confirm the reply applies changes to the current workspace

## Cloudflare deployment

Build:

```bash
bun run build
```

Deploy with Wrangler as usual for your account/project.

Important notes for deployed usage:

- users should open the hosted app in Chromium for folder access
- users should run OpenCode locally with `--cors https://your-hosted-app.example.com`
- the hosted app talks directly from the browser to the local OpenCode server
- local filesystem access still happens in the browser, not in Cloudflare

## Remote project backends

If you want the hosted app to read/write project files through your own backend instead of local folders, use the library surface documented in the root README:

- `createHttpProjectProvider(...)`
- `ProjectFilesystemAdapter`

That lets you back EditorTs with a database, bucket, repo bridge, or any custom HTTP service.
