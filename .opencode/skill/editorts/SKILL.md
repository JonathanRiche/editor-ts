---
name: editorts
description: Apply EditorTs changes by proposing precise replacements across HTML layout, Page JSON, and compiled CSS.
compatibility: opencode
metadata:
  repo: editor-ts
  domain: editorts
---

## What I do
- Help users modify an EditorTs-powered page editor where **content lives in JSON**, and editor behavior lives in runtime JS.
- Translate user requests into **exact file edits** (targeted replacements), typically across:
  - `index.html` (host UI layout + container IDs)
  - `examples/quickstart.ts` (init config + runtime wiring)
  - `page.json` / `styles.css` / `components/<id>.js` (EditorTs page content + assets)

## When to use me
Use this skill when the user is working on EditorTs and the prompt includes any combination of:
- HTML layout (containers/iframe/sidebar)
- Page JSON (components/styles/assets)
- CSS
- Requests like “add a component”, “change styling”, “wire a UI panel”, “make AI apply changes”, “persist data”, etc.

## Core principles (EditorTs)
- **JSON is content data only** (components, styles, assets). Never store editor UI/behavior config in JSON.
- **Runtime JS is editor behavior** (toolbars, permissions, UI wiring, event handlers).
- Prefer modifying existing files instead of inventing new ones.

## Output format rules
When proposing changes:
- Prefer **surgical replacements** over vague descriptions.
- For each edit, provide:
  - file path
  - a short “replace this” snippet and “with this” snippet
  - keep snippets minimal but unique enough to match.
- If multiple files change, list them in a clear sequence.
- Avoid introducing `any` types; use explicit types or `unknown` + narrowing.
- Don’t add new dependencies unless the user explicitly approves.

## Typical mappings
- **UI changes** → `index.html` + `InitConfig.ui` bindings in `examples/quickstart.ts`.
- **Editor behavior changes** → `src/core/init.ts` and supporting `src/core/*` modules.
- **Content/styling changes** → `PageData` JSON and `StyleManager` (compiled CSS) outputs.

## Quick checklist
Before finalizing a patch:
- Ensure any new UI behavior is wired through `init()` config.
- Ensure page JSON stays clean (no toolbars/UI configs).
- Ensure build/test commands still pass (usually `bun run build`).
