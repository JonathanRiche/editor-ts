import { createSignal, onCleanup, onMount } from 'solid-js';

type AppShellProps = {
  fsSupported: boolean;
  workspaceMode: 'demo' | 'remote' | 'folder';
  folderName: string | null;
  statusText: string;
  aiBaseUrl: string;
  onAiBaseUrlChange: (value: string) => void;
  onConnectFolder: () => void;
  onUseRemoteWorkspace: () => void;
  onUseDemoWorkspace: () => void;
};

export default function AppShell(props: AppShellProps) {
  const isFolderMode = () => props.workspaceMode === 'folder';
  const isRemoteMode = () => props.workspaceMode === 'remote';
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<'workspace' | 'ai' | 'structure'>('workspace');
  const [activeMainTab, setActiveMainTab] = createSignal<'chat' | 'editor' | 'code'>('chat');
  let observer: MutationObserver | undefined;

  onMount(() => {
    const root = document.documentElement;
    const syncMainTab = () => {
      const next = root.getAttribute('data-editorts-view');
      if (next === 'editor' || next === 'code') {
        setActiveMainTab(next);
      }
    };

    observer = new MutationObserver(syncMainTab);
    observer.observe(root, { attributes: true, attributeFilter: ['data-editorts-view'] });
  });

  onCleanup(() => {
    observer?.disconnect();
  });

  return (
    <div class="shell">
      <aside class="sidebar">
        {/* Fixed header area */}
        <div class="sidebar-header">
          <section class="hero-card">
            <div class="hero-heading">
              <p class="eyebrow">Hosted Review Shell</p>
              <h1 class="hero-title">EditorTs Solid + Local OpenCode</h1>
            </div>
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
                disabled={isRemoteMode()}
                onClick={props.onUseRemoteWorkspace}
              >
                Use Remote Workspace
              </button>
              <button
                type="button"
                class="secondary-btn"
                disabled={props.workspaceMode === 'demo'}
                onClick={props.onUseDemoWorkspace}
              >
                Use Demo Workspace
              </button>
            </div>

            <div class="status-stack">
              <div class="status-chip">
                <span class={`status-dot ${isFolderMode() ? 'live' : isRemoteMode() ? 'remote' : 'demo'}`} />
                <span>{isFolderMode() ? `Folder connected${props.folderName ? `: ${props.folderName}` : ''}` : isRemoteMode() ? 'Remote workspace (same-origin API)' : 'Demo workspace (SQLocal persisted)'}</span>
              </div>
              <p class="status-text">{props.statusText}</p>
            </div>

            <p class="support-note">
              Full local-files workflow requires Chromium because it depends on the File System Access API.
              {!props.fsSupported ? ' This browser does not expose folder picking.' : ''}
            </p>
          </section>
        </div>

        {/* Tab navigation -- fixed below header */}
        <nav class="sidebar-nav" aria-label="Sidebar sections">
          <button type="button" class="sidebar-tab" aria-pressed={activeSidebarTab() === 'workspace'} onClick={() => setActiveSidebarTab('workspace')}>Workspace</button>
          <button type="button" class="sidebar-tab" aria-pressed={activeSidebarTab() === 'ai'} onClick={() => setActiveSidebarTab('ai')}>AI</button>
          <button type="button" class="sidebar-tab" aria-pressed={activeSidebarTab() === 'structure'} onClick={() => setActiveSidebarTab('structure')}>Structure</button>
        </nav>

        {/* Independently scrollable panel area */}
        <div class="sidebar-scrollable">
          <div class="sidebar-panels">
            <div class="sidebar-panel" hidden={activeSidebarTab() !== 'workspace'}>
              <section class="card">
                <strong>Pages</strong>
                <div id="pages-container" />
              </section>

              <section class="card">
                <strong>Selected</strong>
                <div id="selected-info" />
              </section>

              <section class="card">
                <strong>Stats</strong>
                <div id="stats-container" />
              </section>
            </div>

            <div class="sidebar-panel" hidden={activeSidebarTab() !== 'ai'}>
              <section class="card ai-card">
                <div class="card-heading">
                  <strong>AI connection</strong>
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
                </div>

                <pre id="ai-health-status" class="status-pre" />
                <p class="helper-copy">Use the main Chat tab for session history and the full conversation workspace.</p>
              </section>
            </div>

            <div class="sidebar-panel" hidden={activeSidebarTab() !== 'structure'}>
              <section class="card">
                <strong>Layers</strong>
                <div id="layers-container" />
              </section>

              <section class="card">
                <strong>Components</strong>
                <div id="component-palette" />
              </section>
            </div>
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="tabs" data-main-tab={activeMainTab()}>
          <button id="tab-chat" type="button" aria-pressed={activeMainTab() === 'chat'} onClick={() => setActiveMainTab('chat')}>Chat</button>
          <button id="tab-editor" type="button" onClick={() => setActiveMainTab('editor')}>Editor</button>
          <button id="tab-code" type="button" onClick={() => setActiveMainTab('code')}>Code</button>
        </div>

        <section class="chat-workspace" hidden={activeMainTab() !== 'chat'}>
          <aside class="chat-history card">
            <div class="card-heading">
              <strong>Session history</strong>
              <button id="ai-session-new" type="button" class="secondary-btn">New</button>
            </div>
            <div id="ai-session-list" class="chat-session-list" />
          </aside>

          <div class="chat-stage">
            <div class="card chat-toolbar-card">
              <div class="card-heading">
                <strong>OpenCode chat</strong>
                <div class="chat-toolbar-actions">
                  <button id="ai-chat-apply" type="button" class="secondary-btn" disabled>Apply last reply</button>
                </div>
              </div>

              <div class="chat-toolbar-meta">
                <label class="field chat-model-field">
                  <span>Model</span>
                  <select id="ai-model-select" />
                </label>
                <div id="ai-chat-status" class="chat-status" data-state="idle" aria-live="polite">Ready</div>
              </div>
            </div>

            <div
              id="ai-chat-root"
              data-editorts-ai-chat-root
              class="ai-chat-panel chat-panel"
            >
              <pre id="ai-chat-log" class="chat-log chat-log-main" />

              <div class="chat-compose card">
                <label class="field">
                  <span>Prompt</span>
                  <textarea id="ai-chat-input" placeholder="Ask OpenCode to refactor the hero, tune CSS, or update project files..." />
                </label>

                <div class="ai-actions">
                  <button id="ai-chat-send" type="button" class="primary-btn">Send & Apply</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div class="workspace-stage" hidden={activeMainTab() === 'chat'}>
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
        </div>
      </main>

      <div
        id="command-palette"
        role="dialog"
        aria-modal="true"
        aria-hidden="true"
        style="display:none; position:fixed; inset:0; background: rgba(6,8,14,0.65); align-items:flex-start; justify-content:center; padding-top:12vh; z-index:1200; backdrop-filter: blur(4px);"
      >
        <div style="background:#171f2a; border:1px solid rgba(245,230,200,0.1); border-radius:8px; width:min(520px, 92vw); box-shadow: 0 18px 45px rgba(0,0,0,0.4); padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div id="command-palette-title" style="font-family:'JetBrains Mono',monospace; font-weight:600; font-size:0.82rem; color:#e8dcc8;">Command Palette</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:0.68rem; color:#6b6050;">Add a component or run a command.</div>
            </div>
            <button id="command-palette-close" type="button" style="background:transparent; border:1px solid rgba(245,230,200,0.1); border-radius:4px; color:#9a8e7a; padding:0.3rem 0.6rem; cursor:pointer;">x</button>
          </div>
          <input id="command-palette-input" type="text" placeholder="Search components..." aria-labelledby="command-palette-title" style="width:100%; padding:0.6rem 0.7rem; border:1px solid rgba(245,230,200,0.1); border-radius:4px; background:rgba(12,16,24,0.6); color:#e8dcc8; font-family:'JetBrains Mono',monospace; font-size:0.82rem;" />
          <div id="command-palette-results" role="listbox" style="display:flex; flex-direction:column; gap:0.25rem; max-height:320px; overflow:auto;"></div>
          <div id="command-palette-hint" style="font-family:'JetBrains Mono',monospace; font-size:0.65rem; color:#6b6050;">Press Enter to add to selected or to the page root.</div>
        </div>
      </div>
    </div>
  );
}
