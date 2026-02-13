# Adapter Model Tasks

Goal: support multiple editor content backends, including the current JSON model and a project-filesystem model (`tsx`, `ts`, `js`, `css`, `html`).

## 1) Define the content adapter contract

- [ ] Add a new `ContentAdapter` interface (separate from `StorageAdapter`).
- [ ] Define canonical editor snapshot shape (e.g. `EditorContentSnapshot`) used in memory.
- [ ] Include required methods:
  - [ ] `load()` -> snapshot
  - [ ] `save(snapshot)`
  - [ ] `listFiles()`
  - [ ] `readFile(path)`
  - [ ] `writeFile(path, content)`
- [ ] Add adapter capability flags (read-only, supports-file-tree, supports-components, etc.).

## 2) Implement JSON adapter (default)

- [ ] Implement `JsonContentAdapter` using existing `PageData`/`PageBody` behavior.
- [ ] Keep current components-first precedence unchanged.
- [ ] Ensure runtime config (toolbars/UI/handlers) remains out of saved JSON.
- [ ] Make this the default when no adapter is passed (backward compatible).

## 3) Introduce init/config wiring

- [ ] Extend `InitConfig` with a content adapter option (without breaking existing `data` usage).
- [ ] Add migration path:
  - [ ] If `data` exists, internally wrap with `JsonContentAdapter`.
  - [ ] If adapter exists, bootstrap editor state from adapter `load()`.
- [ ] Keep current public APIs working (`save`, `saveTo`, `loadFrom`) and define adapter-aware behavior.

## 4) Refactor workspace/file panels to adapter-driven IO

- [ ] Replace hardcoded workspace file generation with adapter file APIs.
- [ ] Keep current virtual files (`page.json`, `styles.css`, `components/*.js`) for JSON mode.
- [ ] Add support for real file trees when filesystem adapter is active.
- [ ] Ensure code tabs (files/viewer/js/css/json/jsx) map correctly per adapter capabilities.

## 5) Implement filesystem/project adapter

- [ ] Add `ProjectFilesystemAdapter` that reads/writes a user project tree.
- [ ] Define mapping rules from project files -> editor snapshot.
- [ ] Define reverse mapping from snapshot -> project files.
- [ ] Handle mixed source setups (e.g. HTML + CSS + TSX).
- [ ] Handle missing/invalid files with safe fallbacks and clear errors.

## 6) AI integration updates

- [ ] Replace fixed AI path allowlist with adapter-provided editable paths.
- [ ] Build AI snapshot from adapter file tree (not hardcoded files).
- [ ] Apply AI replacements through adapter write operations.
- [ ] Keep guardrails so AI cannot write outside allowed paths.

## 7) Persistence and version control behavior

- [ ] Define what `saveTo`/`loadFrom` mean with non-JSON adapters.
- [ ] Keep version history persisted separately from content data.
- [ ] Ensure snapshots remain serializable and stable across adapters.

## 8) Validation + tests

- [ ] Unit tests for adapter interface conformance.
- [ ] Unit tests for JSON adapter (regression coverage).
- [ ] Unit tests for filesystem adapter (file mapping, edge cases).
- [ ] Integration tests for `init()` with both adapter types.
- [ ] AI replacement tests for adapter-driven path handling.

## 9) Docs + examples

- [ ] Document adapter architecture and separation of concerns.
- [ ] Update README with adapter setup examples.
- [ ] Add quickstart example for JSON adapter mode.
- [ ] Add quickstart/example for filesystem adapter mode.
- [ ] Note migration guidance for existing users.

## 10) Rollout plan

- [ ] Phase 1: interface + JSON adapter + backward-compatible wiring.
- [ ] Phase 2: adapter-driven files panel + AI path abstraction.
- [ ] Phase 3: filesystem adapter + docs/examples + full test matrix.
