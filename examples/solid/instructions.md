# Solid Demo Instructions

This folder is the main demo and integration harness for the `editor-ts` library.

If a task is about:

- the primary demo app
- manual testing of EditorTs behavior
- validating new UI/runtime features quickly
- checking how the library behaves in a real app

start here first.

## What This Demo Is

`examples/solid` is the main working demo for the repo. It is not a separate product. It is a SolidJS host app that imports the local library source from the repo root and exercises the real EditorTs runtime.

Important:

- The demo imports EditorTs from [`/home/rtg/development/blinkx-projects/editor-ts/index.ts`](/home/rtg/development/blinkx-projects/editor-ts/index.ts), not from npm.
- The main app wiring lives in [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/App.tsx`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/App.tsx).
- `init()` is called here, so changes to core runtime behavior often show up in this demo immediately.
- The core library entrypoints live under [`/home/rtg/development/blinkx-projects/editor-ts/src/core`](/home/rtg/development/blinkx-projects/editor-ts/src/core).

## How To Run It

From this directory:

```bash
cd examples/solid
bun install
bun run dev
```

Default dev URL:

```text
http://localhost:2022
```

Useful scripts from [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/package.json`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/package.json):

- `bun run dev` starts the Vite dev server
- `bun run build` builds the Solid demo
- `bun run preview` previews the production build
- `bun run dev:with-opencode` starts the demo plus a local OpenCode server helper script
- `bun run smoke` runs the smoke test script for demo, remote, and folder workflows

## Main Modes In The Demo

This app switches EditorTs between three content adapters:

- Demo workspace: `JsonContentAdapter` with SQLocal-backed persistence
- Remote workspace: `ProjectFilesystemAdapter` backed by `createHttpProjectProvider('/api/project')`
- Folder workspace: `ProjectFilesystemAdapter` backed by the browser File System Access API

The mode setup is in [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/App.tsx`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/App.tsx). The same-origin remote file API lives in [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/remoteProject.ts`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/remoteProject.ts).

## How It Uses The Main Library

This demo is valuable because it exercises real library surfaces instead of mock wrappers:

- `init(...)`
- `JsonContentAdapter`
- `ProjectFilesystemAdapter`
- `createHttpProjectProvider(...)`
- runtime UI config under `ui`
- runtime toolbar config under `toolbars`
- optional AI integration through `aiProvider`

When you change library behavior, check whether the Solid demo still works before assuming the change is safe.

## Files To Read First

- [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/App.tsx`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/App.tsx): main demo behavior and `init()` config
- [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/AppShell.tsx`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/AppShell.tsx): host UI layout
- [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/remoteProject.ts`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/src/remoteProject.ts): same-origin remote workspace API
- [`/home/rtg/development/blinkx-projects/editor-ts/examples/solid/vite.config.ts`](/home/rtg/development/blinkx-projects/editor-ts/examples/solid/vite.config.ts): Vite config and local dev routing
- [`/home/rtg/development/blinkx-projects/editor-ts/src/core/init.ts`](/home/rtg/development/blinkx-projects/editor-ts/src/core/init.ts): core editor boot flow

## Repo-Specific Expectations

Keep the repo architecture in mind while working here:

- Content data belongs in JSON or file content
- Editor behavior belongs in runtime config
- User-facing demo changes should usually be wired here because this is the main quick manual test surface
- Do not treat this demo as a disposable example; regressions here usually indicate real integration problems

## Practical Agent Guidance

If the user asks for a feature and does not specify another example, prefer validating it in `examples/solid`.

If a change affects:

- `init()`
- content adapters
- storage
- code tabs/editors
- AI integration
- remote project loading
- folder mode

verify the behavior here, because this folder is the most representative end-to-end demo in the repo.
