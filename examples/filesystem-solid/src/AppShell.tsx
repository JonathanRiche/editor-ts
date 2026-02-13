type FsMode = 'browser-folder' | 'server-routes';

type AppShellProps = {
  fsSupported: boolean;
  statusText: string;
  hasProject: boolean;
  mode: FsMode;
  apiBaseUrl: string;
  projectRoot: string;
  onModeChange: (mode: FsMode) => void;
  onApiBaseUrlChange: (value: string) => void;
  onProjectRootChange: (value: string) => void;
  onPickProject: () => void;
  onConnectServerRoutes: () => void;
  onReloadProject: () => void;
};

export default function AppShell(props: AppShellProps) {
  return (
    <div class="shell">
      <aside class="sidebar">
        <h1>EditorTs Filesystem + Solid</h1>

        <section class="card controls-card">
          <strong>Project Folder</strong>
          <div class="mode-row">
            <button
              type="button"
              class={`mode-btn ${props.mode === 'browser-folder' ? 'active' : ''}`}
              onClick={() => props.onModeChange('browser-folder')}
            >
              Browser Folder
            </button>
            <button
              type="button"
              class={`mode-btn ${props.mode === 'server-routes' ? 'active' : ''}`}
              onClick={() => props.onModeChange('server-routes')}
            >
              Server Routes
            </button>
          </div>

          {props.mode === 'browser-folder' ? (
            <p>
              Pick a local folder to grant EditorTs file access.
            </p>
          ) : (
            <p>
              Connect through HTTP endpoints that read/write files on the host runtime.
            </p>
          )}

          {props.mode === 'server-routes' && (
            <div class="server-fields">
              <label class="field">
                <span>API Base URL</span>
                <input
                  type="text"
                  value={props.apiBaseUrl}
                  onInput={(event) => props.onApiBaseUrlChange(event.currentTarget.value)}
                  placeholder="http://127.0.0.1:5173"
                />
              </label>
              <label class="field">
                <span>Project Root Path</span>
                <input
                  type="text"
                  value={props.projectRoot}
                  onInput={(event) => props.onProjectRootChange(event.currentTarget.value)}
                  placeholder="/home/user/my-project"
                />
              </label>
            </div>
          )}

          <div class="controls-row">
            <button
              type="button"
              class="action-btn"
              onClick={() => {
                if (props.mode === 'browser-folder') {
                  props.onPickProject();
                } else {
                  props.onConnectServerRoutes();
                }
              }}
            >
              {props.mode === 'browser-folder' ? 'Open Folder' : 'Connect Routes'}
            </button>
            <button
              type="button"
              class="action-btn"
              disabled={!props.hasProject}
              onClick={props.onReloadProject}
            >
              Reload
            </button>
          </div>
          <div class="status-line">
            <span class={`dot ${props.hasProject ? 'ok' : 'idle'}`} />
            <span>{props.statusText}</span>
          </div>
          {!props.fsSupported && (
            <p class="warning">
              Browser-folder mode requires File System Access API.
              Use latest Chrome/Edge, or switch to Server Routes mode.
            </p>
          )}
        </section>

        <section class="card">
          <strong>Stats</strong>
          <div id="stats-container" />
        </section>
        <section class="card">
          <strong>Layers</strong>
          <div id="layers-container" />
        </section>
        <section class="card">
          <strong>Selected</strong>
          <div id="selected-info" />
        </section>
        <section class="card">
          <strong>Pages</strong>
          <div id="pages-container" />
        </section>
        <section class="card">
          <strong>Components</strong>
          <div id="component-palette" />
        </section>
      </aside>

      <main class="content">
        <div class="tabs">
          <button id="tab-editor" type="button">Editor</button>
          <button id="tab-code" type="button">Code</button>
        </div>
        <iframe id="preview-iframe" class="preview-frame" title="Editor preview" />

        <div class="code-tabs">
          <button id="code-tab-files" type="button">Files</button>
          <button id="code-tab-viewer" type="button">View</button>
          <button id="code-tab-js" type="button">JS</button>
          <button id="code-tab-css" type="button">CSS</button>
          <button id="code-tab-json" type="button">JSON</button>
          <button id="code-tab-jsx" type="button">JSX</button>
        </div>

        <div class="code-panels">
          <div id="files-viewer-container" />
          <div id="viewer-editor-container" />
          <div id="js-editor-container" />
          <div id="css-editor-container" />
          <div id="json-editor-container" />
          <div id="jsx-editor-container" />
        </div>
      </main>

      <div
        id="command-palette"
        role="dialog"
        aria-modal="true"
        aria-hidden="true"
        style="display:none; position:fixed; inset:0; background: rgba(0,0,0,0.35); align-items:flex-start; justify-content:center; padding-top:12vh; z-index:1200;"
      >
        <div style="background:white; border-radius:12px; width:min(520px, 92vw); box-shadow: 0 10px 25px rgba(15,23,42,0.12); padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div id="command-palette-title" style="font-weight:600;">Command Palette</div>
              <div style="font-size:0.75rem; opacity:0.6;">Add a component or run a command.</div>
            </div>
            <button id="command-palette-close" type="button">✕</button>
          </div>
          <input id="command-palette-input" type="text" placeholder="Search components..." aria-labelledby="command-palette-title" style="width:100%; padding:0.5rem; border:1px solid rgba(15,23,42,0.15); border-radius:8px;" />
          <div id="command-palette-results" role="listbox" style="display:flex; flex-direction:column; gap:0.35rem; max-height:320px; overflow:auto;"></div>
          <div id="command-palette-hint" style="font-size:0.75rem; opacity:0.6;">Press Enter to add to selected or to the page root.</div>
        </div>
      </div>
    </div>
  );
}
