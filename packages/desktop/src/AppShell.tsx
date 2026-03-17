import { createSignal, onCleanup, onMount } from 'solid-js';

import { AiConnectionPanel, AiWorkspacePanel } from '@editorts/starter-shared/AiPanels';

import type {
  ProjectFilesystemPermissionReply,
  ProjectFilesystemPermissionRequest,
} from 'editor-ts';

type FsMode = 'browser-folder' | 'server-routes';

type RecentProject = {
  path: string;
  label?: string;
  openedAt?: number;
};

type AppShellProps = {
  fsSupported: boolean;
  nativeRuntime?: boolean;
  advancedUiReady: boolean;
  statusText: string;
  hasProject: boolean;
  mode: FsMode;
  apiBaseUrl: string;
  projectRoot: string;
  previewBaseUrl: string;
  aiBaseUrl: string;
  aiDirectory: string;
  recentProjects: RecentProject[];
  permissionRequest: ProjectFilesystemPermissionRequest | null;
  onModeChange: (mode: FsMode) => void;
  onApiBaseUrlChange: (value: string) => void;
  onProjectRootChange: (value: string) => void;
  onPreviewBaseUrlChange: (value: string) => void;
  onAiBaseUrlChange: (value: string) => void;
  onAiDirectoryChange: (value: string) => void;
  onMainTabActivate: (tab: 'chat' | 'editor' | 'code') => void;
  onOpenRecentProject: (projectPath: string) => void;
  onPickProject: () => void;
  onConnectServerRoutes: () => void;
  onReloadProject: () => void;
  onPermissionReply: (reply: ProjectFilesystemPermissionReply) => void;
};

const cx = (...parts: Array<string | false | null | undefined>): string => {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
};

export default function AppShell(props: AppShellProps) {
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<'workspace' | 'ai' | 'structure'>('workspace');
  const [activeMainTab, setActiveMainTab] = createSignal<'chat' | 'editor' | 'code'>('editor');
  let observer: MutationObserver | undefined;

  const workspaceDescription = () => {
    if (props.nativeRuntime && props.mode === 'browser-folder') {
      return 'Open a native project directory through the Electrobun shell. EditorTs will use the desktop RPC filesystem provider instead of the browser File System Access API.';
    }

    if (props.mode === 'browser-folder') {
      return 'Pick a local folder to grant EditorTs file access through the browser File System Access API.';
    }

    return 'Connect through HTTP endpoints that read and write files on the host runtime.';
  };

  const modeSummary = () => {
    if (props.nativeRuntime && props.mode === 'browser-folder') {
      return 'Native folder';
    }

    if (props.mode === 'browser-folder') {
      return 'Browser folder';
    }

    return 'Server routes';
  };

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
        <div class="sidebar-inner">
          <div class="sidebar-header">
            <section class="hero-card">
              <div class="brand-row">
                <span class="brand-badge" aria-hidden="true">
                  {'</>'}
                </span>
                <div class="brand-copy">
                  <span class="eyebrow">Filesystem demo</span>
                  <h1>Editor TS</h1>
                </div>
              </div>

              <p class="hero-text">
                Open a project folder or host routes, then use the same AI workspace from the main Solid demo to inspect and apply real file changes.
              </p>

              <div class="hero-actions">
                <button
                  type="button"
                  class="button button-primary"
                  onClick={() => {
                    if (props.mode === 'browser-folder') {
                      props.onPickProject();
                    } else {
                      props.onConnectServerRoutes();
                    }
                  }}
                >
                  {props.mode === 'browser-folder'
                    ? props.nativeRuntime ? 'Open Native Folder' : 'Open Folder'
                    : 'Connect Routes'}
                </button>
                <button
                  type="button"
                  class="button button-secondary"
                  disabled={!props.hasProject}
                  onClick={props.onReloadProject}
                >
                  Reload Project
                </button>
              </div>

              <div class="status-box">
                <div class="status-heading">
                  <span class={cx('status-dot', props.hasProject && 'is-live')} />
                  <span>{modeSummary()}</span>
                </div>
                <p>{props.statusText}</p>
              </div>

              <p class="hero-note">
                {props.nativeRuntime
                  ? 'Native mode uses the Electrobun shell for folder access and desktop persistence.'
                  : `Folder mode needs Chromium.${!props.fsSupported ? ' This browser does not expose folder picking.' : ''}`}
              </p>
            </section>
          </div>

          <nav class="sidebar-nav" aria-label="Filesystem sidebar sections">
            <button
              type="button"
              class={cx('sidebar-tab', activeSidebarTab() === 'workspace' && 'is-active')}
              aria-pressed={activeSidebarTab() === 'workspace'}
              onClick={() => setActiveSidebarTab('workspace')}
            >
              Workspace
            </button>
            <button
              type="button"
              class={cx('sidebar-tab', activeSidebarTab() === 'ai' && 'is-active')}
              aria-pressed={activeSidebarTab() === 'ai'}
              onClick={() => setActiveSidebarTab('ai')}
            >
              AI
            </button>
            <button
              type="button"
              class={cx('sidebar-tab', activeSidebarTab() === 'structure' && 'is-active')}
              aria-pressed={activeSidebarTab() === 'structure'}
              onClick={() => setActiveSidebarTab('structure')}
            >
              Structure
            </button>
          </nav>

          <div class="sidebar-scrollable">
            <div class="panel-stack" hidden={activeSidebarTab() !== 'workspace'}>
              <section class="card controls-card">
                <div class="card-heading">
                  <strong class="section-title">Workspace</strong>
                  <span class="section-chip">filesystem</span>
                </div>

                <div class="mode-row">
                  <button
                    type="button"
                    class={cx('mode-btn', props.mode === 'browser-folder' && 'active')}
                    onClick={() => props.onModeChange('browser-folder')}
                  >
                    {props.nativeRuntime ? 'Native Folder' : 'Browser Folder'}
                  </button>
                  <button
                    type="button"
                    class={cx('mode-btn', props.mode === 'server-routes' && 'active')}
                    onClick={() => props.onModeChange('server-routes')}
                  >
                    Server Routes
                  </button>
                </div>

                <p>{workspaceDescription()}</p>

                {props.mode === 'server-routes' && (
                  <div class="server-fields">
                    <label class="field">
                      <span class="field-caption">API Base URL</span>
                      <input
                        type="text"
                        value={props.apiBaseUrl}
                        onInput={(event) => props.onApiBaseUrlChange(event.currentTarget.value)}
                        placeholder="http://127.0.0.1:5173"
                      />
                    </label>
                    <label class="field">
                      <span class="field-caption">Project Root Path</span>
                      <input
                        type="text"
                        value={props.projectRoot}
                        onInput={(event) => props.onProjectRootChange(event.currentTarget.value)}
                        placeholder="/home/user/my-project"
                      />
                    </label>
                  </div>
                )}

                <label class="field">
                  <span class="field-caption">App Preview URL</span>
                  <input
                    type="text"
                    value={props.previewBaseUrl}
                    onInput={(event) => props.onPreviewBaseUrlChange(event.currentTarget.value)}
                    placeholder="http://127.0.0.1:4173"
                  />
                </label>
                <p>
                  Optional. Point this at the app dev server or preview server when you want the canvas to boot the real app instead of the derived page preview.
                </p>

                <div class={cx('permission-panel', props.permissionRequest && 'active')}>
                  <div class="card-heading">
                    <strong class="section-title">Permissions</strong>
                    <span class="section-chip">guard</span>
                  </div>
                  {props.permissionRequest ? (
                    <>
                      <div class="permission-details">
                        <div>
                          <span class="permission-key">Action</span>
                          <span class="permission-value">{props.permissionRequest.permission}</span>
                        </div>
                        <div>
                          <span class="permission-key">Targets</span>
                          <span class="permission-value">{props.permissionRequest.paths.join(', ')}</span>
                        </div>
                      </div>
                      <div class="permission-actions">
                        <button
                          type="button"
                          class="button button-small button-danger"
                          onClick={() => props.onPermissionReply('reject')}
                        >
                          Deny
                        </button>
                        <button
                          type="button"
                          class="button button-small button-secondary"
                          onClick={() => props.onPermissionReply('always')}
                        >
                          Allow Always
                        </button>
                        <button
                          type="button"
                          class="button button-small button-primary"
                          onClick={() => props.onPermissionReply('once')}
                        >
                          Allow Once
                        </button>
                      </div>
                    </>
                  ) : (
                    <p class="permission-idle">No pending permission requests.</p>
                  )}
                </div>

                {!props.fsSupported && (
                  <p class="warning">
                    Browser-folder mode requires File System Access API. Use latest Chrome or Edge, or switch to Server Routes mode.
                  </p>
                )}
              </section>

              {props.nativeRuntime && props.recentProjects.length > 0 && (
                <section class="card">
                  <div class="card-heading">
                    <strong class="section-title">Recent projects</strong>
                    <span class="section-chip">{props.recentProjects.length}</span>
                  </div>
                  <div class="recent-projects">
                    {props.recentProjects.map((project) => (
                      <button
                        type="button"
                        class="recent-project"
                        onClick={() => props.onOpenRecentProject(project.path)}
                      >
                        <span class="recent-project-label">
                          {project.label ?? project.path.split('/').filter(Boolean).at(-1) ?? project.path}
                        </span>
                        <span class="recent-project-path">{project.path}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section class="card">
                <strong class="section-title">Pages</strong>
                <div id="pages-container" />
              </section>

              <section class="card">
                <strong class="section-title">Selected</strong>
                <div id="selected-info" />
              </section>

              <section class="card">
                <strong class="section-title">Stats</strong>
                <div id="stats-container" />
              </section>
            </div>

            <div class="panel-stack" hidden={activeSidebarTab() !== 'ai'}>
              <AiConnectionPanel aiBaseUrl={props.aiBaseUrl} onAiBaseUrlChange={props.onAiBaseUrlChange} />

              <section class="card">
                <strong class="section-title">AI workspace</strong>
                <label class="field">
                  <span class="field-caption">AI Working Directory</span>
                  <input
                    type="text"
                    value={props.aiDirectory}
                    onInput={(event) => props.onAiDirectoryChange(event.currentTarget.value)}
                    placeholder={props.mode === 'server-routes' ? props.projectRoot || '/home/user/my-project' : '/absolute/path/to/project'}
                  />
                </label>
                <p>
                  {props.nativeRuntime
                    ? 'OpenCode needs a real absolute project path to scope sessions and edits. Native folder connections reuse the selected project path automatically, but you can still override it here.'
                    : 'OpenCode needs a real absolute project path to scope sessions and edits. In Server Routes mode this should match the project root. In Browser Folder mode, enter the actual local path manually because the browser does not expose it.'}
                </p>
              </section>
            </div>

            <div class="panel-stack" hidden={activeSidebarTab() !== 'structure'}>
              <section class="card">
                <strong class="section-title">Layers</strong>
                <div id="layers-container" />
              </section>

              <section class="card">
                <strong class="section-title">Components</strong>
                <div id="component-palette" />
              </section>
            </div>
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="content-topbar">
          <div class="content-copy">
            <span class="eyebrow">Project canvas</span>
            <h2>Filesystem-backed editor workspace</h2>
            <p>
              Open a live project, preview the derived page, inspect AI-generated file changes, and apply them in the same shell.
            </p>
          </div>

          <div class="tabs">
            <button
              id="tab-chat"
              type="button"
              class={cx('tab-btn', activeMainTab() === 'chat' && 'active')}
              aria-pressed={activeMainTab() === 'chat'}
              onClick={() => {
                setActiveMainTab('chat');
                props.onMainTabActivate('chat');
              }}
            >
              Chat
            </button>
            <button
              id="tab-editor"
              type="button"
              class={cx('tab-btn', activeMainTab() === 'editor' && 'active')}
              aria-pressed={activeMainTab() === 'editor'}
              onClick={() => {
                setActiveMainTab('editor');
                props.onMainTabActivate('editor');
              }}
            >
              Editor
            </button>
            <button
              id="tab-code"
              type="button"
              class={cx('tab-btn', activeMainTab() === 'code' && 'active')}
              aria-pressed={activeMainTab() === 'code'}
              onClick={() => {
                setActiveMainTab('code');
                props.onMainTabActivate('code');
              }}
            >
              Code
            </button>
          </div>
        </div>

        <AiWorkspacePanel hidden={activeMainTab() !== 'chat'} />

        {!props.advancedUiReady && activeMainTab() === 'chat' && (
          <section class="card">
            <strong class="section-title">Preparing AI workspace</strong>
            <p>Loading AI chat and session controls for this project.</p>
          </section>
        )}

        <div class="workspace-stage" hidden={activeMainTab() === 'chat'}>
          <div class="stage-header">
            <div>
              <span class="stage-label">{modeSummary()}</span>
              <p>{props.statusText}</p>
            </div>
          </div>

          <iframe id="preview-iframe" class="preview-frame" title="Editor preview" />

          <div class="code-shell">
            <div class="code-tabs">
              <button id="code-tab-files" type="button" class="tab-btn">Files</button>
              <button id="code-tab-viewer" type="button" class="tab-btn">View</button>
              <button id="code-tab-js" type="button" class="tab-btn">JS</button>
              <button id="code-tab-css" type="button" class="tab-btn">CSS</button>
              <button id="code-tab-json" type="button" class="tab-btn">JSON</button>
              <button id="code-tab-jsx" type="button" class="tab-btn">JSX</button>
            </div>

            {!props.advancedUiReady && activeMainTab() === 'code' ? (
              <section class="card">
                <strong class="section-title">Preparing code workspace</strong>
                <p>Loading files, code editors, and workspace tools for this project.</p>
              </section>
            ) : (
              <div class="code-panels">
              <div id="files-viewer-container" />
              <div id="viewer-editor-container" />
              <div id="js-editor-container" />
              <div id="css-editor-container" />
              <div id="json-editor-container" />
              <div id="jsx-editor-container" />
              </div>
            )}
          </div>
        </div>
      </main>

      <div
        id="command-palette"
        class="command-palette"
        role="dialog"
        aria-modal="true"
        aria-hidden="true"
        style="display:none; position:fixed; inset:0; background: rgba(0,0,0,0.35); align-items:flex-start; justify-content:center; padding-top:12vh; z-index:1200;"
      >
        <div class="command-palette-card">
          <div class="command-palette-header">
            <div>
              <div id="command-palette-title" class="command-palette-title">Command Palette</div>
              <div class="command-palette-copy">Add a component or run a command.</div>
            </div>
            <button id="command-palette-close" type="button" class="command-palette-close">Close</button>
          </div>
          <input
            id="command-palette-input"
            type="text"
            class="command-palette-input"
            placeholder="Search components..."
            aria-labelledby="command-palette-title"
          />
          <div id="command-palette-results" class="command-palette-results" role="listbox" />
          <div id="command-palette-hint" class="command-palette-hint">Press Enter to add to selected or to the page root.</div>
        </div>
      </div>
    </div>
  );
}
