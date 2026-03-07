type AppShellProps = {
  fsSupported: boolean;
  workspaceMode: 'demo' | 'folder';
  folderName: string | null;
  statusText: string;
  aiBaseUrl: string;
  onAiBaseUrlChange: (value: string) => void;
  onConnectFolder: () => void;
  onUseDemoWorkspace: () => void;
};

export default function AppShell(props: AppShellProps) {
  const isFolderMode = () => props.workspaceMode === 'folder';

  return (
    <div class="shell">
      <aside class="sidebar">
        <section class="hero-card">
          <p class="eyebrow">Hosted Review Shell</p>
          <h1>EditorTs Solid + Local OpenCode</h1>
          <p class="hero-copy">
            Review the editor in the cloud, then connect your own Chromium browser folder and local OpenCode server for real project edits.
          </p>

          <div class="connection-actions">
            <button type="button" class="primary-btn" onClick={props.onConnectFolder}>
              {isFolderMode() ? 'Reconnect Folder' : 'Connect Folder'}
            </button>
            <button
              type="button"
              class="secondary-btn"
              disabled={!isFolderMode()}
              onClick={props.onUseDemoWorkspace}
            >
              Use Demo Workspace
            </button>
          </div>

          <div class="status-stack">
            <div class="status-chip">
              <span class={`status-dot ${isFolderMode() ? 'live' : 'demo'}`} />
              <span>{isFolderMode() ? `Folder connected${props.folderName ? `: ${props.folderName}` : ''}` : 'Demo workspace (SQLocal persisted)'}</span>
            </div>
            <p class="status-text">{props.statusText}</p>
          </div>

          <p class="support-note">
            Full local-files workflow requires Chromium because it depends on the File System Access API.
            {!props.fsSupported ? ' This browser does not expose folder picking.' : ''}
          </p>
        </section>

        <section class="card ai-card">
          <div class="card-heading">
            <strong>Local OpenCode</strong>
            <a id="ai-chat-link" href="#" target="_blank" rel="noopener noreferrer">Open chats</a>
          </div>

          <label class="field">
            <span>OpenCode base URL</span>
            <input
              id="ai-base-url"
              type="text"
              value={props.aiBaseUrl}
              onInput={(event) => props.onAiBaseUrlChange(event.currentTarget.value)}
              placeholder="http://127.0.0.1:4096"
            />
          </label>

          <p class="helper-copy">
            Run `opencode serve --port 4096 --cors https://your-app.example.com` on the same machine as your browser.
          </p>

          <div class="ai-health-row">
            <button id="ai-health-btn" type="button" class="secondary-btn">Check health</button>
            <button id="ai-session-new" type="button" class="secondary-btn">New session</button>
          </div>

          <pre id="ai-health-status" class="status-pre" />

          <div
            id="ai-chat-root"
            data-editorts-ai-chat-root
            class="ai-chat-panel"
          >
            <div class="card-heading compact">
              <strong>AI chat</strong>
              <button id="ai-chat-expand" type="button" class="secondary-btn icon-btn" aria-expanded="false">Expand</button>
            </div>

            <label class="field">
              <span>Session</span>
              <select id="ai-session-select" />
            </label>

            <label class="field">
              <span>Model</span>
              <select id="ai-model-select" />
            </label>

            <label class="field">
              <span>Prompt</span>
              <textarea id="ai-chat-input" placeholder="Ask OpenCode to refactor the hero, tweak CSS, or update project files..." />
            </label>

            <div class="ai-actions">
              <button id="ai-chat-send" type="button" class="primary-btn">Send & Apply</button>
              <button id="ai-chat-apply" type="button" class="secondary-btn" disabled>Apply last reply</button>
            </div>

            <pre id="ai-chat-log" class="chat-log" />
          </div>
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
        style="display:none; position:fixed; inset:0; background: rgba(6,11,20,0.4); align-items:flex-start; justify-content:center; padding-top:12vh; z-index:1200;"
      >
        <div style="background:white; border-radius:16px; width:min(520px, 92vw); box-shadow: 0 18px 45px rgba(15,23,42,0.18); padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div id="command-palette-title" style="font-weight:600;">Command Palette</div>
              <div style="font-size:0.75rem; opacity:0.6;">Add a component or run a command.</div>
            </div>
            <button id="command-palette-close" type="button">x</button>
          </div>
          <input id="command-palette-input" type="text" placeholder="Search components..." aria-labelledby="command-palette-title" style="width:100%; padding:0.75rem; border:1px solid rgba(15,23,42,0.12); border-radius:10px;" />
          <div id="command-palette-results" role="listbox" style="display:flex; flex-direction:column; gap:0.35rem; max-height:320px; overflow:auto;"></div>
          <div id="command-palette-hint" style="font-size:0.75rem; opacity:0.6;">Press Enter to add to selected or to the page root.</div>
        </div>
      </div>
    </div>
  );
}
