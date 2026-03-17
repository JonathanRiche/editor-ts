import { createSignal, onCleanup, onMount } from 'solid-js';
import { AiConnectionPanel, AiWorkspacePanel } from '@editorts/starter-shared/AiPanels';

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

const cx = (...parts: Array<string | false | null | undefined>): string => {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
};

const buttonBaseClass = 'inline-flex w-full items-center justify-center rounded-[4px] border px-[0.95rem] py-[0.65rem] font-mono text-[0.76rem] font-medium tracking-[0.02em] transition-[background,border-color,color,opacity] duration-150';
const primaryButtonClass = `${buttonBaseClass} border-accent bg-accent text-bg-void hover:border-[#e0ad3a] hover:bg-[#e0ad3a]`;
const secondaryButtonClass = `${buttonBaseClass} border-line-mid bg-transparent text-text-primary hover:border-line-soft hover:bg-white/4 disabled:cursor-not-allowed disabled:opacity-35`;
const smallButtonClass = 'inline-flex items-center justify-center rounded-[4px] border border-line-mid bg-transparent px-[0.55rem] py-[0.3rem] font-mono text-[0.68rem] font-medium tracking-[0.02em] text-text-primary transition-[background,border-color,color,opacity] duration-150 hover:border-line-soft hover:bg-white/4 disabled:cursor-not-allowed disabled:opacity-35';
const cardClass = 'flex flex-col gap-[0.65rem] rounded-[12px] border border-line-soft bg-bg-card p-[0.85rem] shadow-[inset_0_1px_0_rgba(245,230,200,0.04)] backdrop-blur-sm';
const sectionTitleClass = 'font-mono text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-text-secondary';
const fieldLabelClass = 'flex flex-col gap-[0.25rem] font-mono';
const fieldCaptionClass = 'text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-text-muted';
const fieldInputClass = 'w-full rounded-[4px] border border-line-soft bg-bg-input px-[0.7rem] py-[0.6rem] text-[0.82rem] text-text-primary placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft/80';

export default function AppShell(props: AppShellProps) {
  const isFolderMode = () => props.workspaceMode === 'folder';
  const isRemoteMode = () => props.workspaceMode === 'remote';
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<'workspace' | 'ai' | 'structure'>('workspace');
  const [activeMainTab, setActiveMainTab] = createSignal<'chat' | 'editor' | 'code'>('chat');
  let observer: MutationObserver | undefined;

  const sidebarTabClass = (active: boolean): string => {
    return cx(
      'border-b-2 px-[0.5rem] py-[0.55rem] text-center font-mono text-[0.68rem] font-semibold uppercase tracking-[0.06em] transition',
      active
        ? 'border-accent text-accent'
        : 'border-transparent text-text-muted hover:text-text-secondary',
    );
  };

  const mainTabClass = (active: boolean): string => {
    return cx(
      'inline-flex items-center justify-center border px-[1rem] py-[0.55rem] font-mono text-[0.72rem] font-medium uppercase tracking-[0.05em] transition first:rounded-l-[4px] last:rounded-r-[4px] [&+button]:border-l-0',
      active
        ? 'border-accent bg-accent text-bg-void'
        : 'border-line-soft bg-bg-elevated text-text-muted hover:bg-white/4 hover:text-text-primary',
    );
  };

  const workspaceStateLabel = () => {
    if (isFolderMode()) {
      return `Folder connected${props.folderName ? `: ${props.folderName}` : ''}`;
    }
    if (isRemoteMode()) {
      return 'Remote workspace (same-origin API)';
    }
    return 'Demo workspace (SQLocal persisted)';
  };

  const statusDotClass = () => {
    if (isFolderMode()) {
      return 'bg-status-live shadow-[0_0_8px_rgba(62,207,142,0.22)]';
    }
    if (isRemoteMode()) {
      return 'bg-status-remote shadow-[0_0_8px_rgba(110,168,254,0.18)]';
    }
    return 'bg-status-demo shadow-[0_0_8px_rgba(212,160,48,0.22)]';
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
    <div class="shell grid h-screen overflow-hidden bg-bg-void text-text-primary max-lg:grid-cols-1 lg:grid-cols-[minmax(240px,290px)_minmax(0,1fr)]">
      <aside class="sidebar editorts-shell-sidebar sticky top-0 flex h-screen self-start overflow-hidden border-r border-line-dim bg-bg-surface max-lg:static max-lg:max-h-[55vh] max-lg:border-r-0 max-lg:border-b">
        <div class="flex h-full w-full flex-col overflow-hidden">
          <div class="sidebar-header shrink-0 border-b border-line-dim bg-[linear-gradient(180deg,rgba(212,160,48,0.03)_0%,transparent_100%)] px-[0.75rem] pt-[0.7rem] pb-[0.65rem]">
            <section class="hero-card flex flex-col gap-[0.6rem]">
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-[rgba(212,160,48,0.24)] bg-[linear-gradient(180deg,rgba(212,160,48,0.14),rgba(212,160,48,0.05))] px-1.5 font-mono text-[11px] font-semibold tracking-[-0.08em] text-accent shadow-[inset_0_1px_0_rgba(245,230,200,0.08)]"
                  aria-hidden="true"
                >
                  {'</>'}
                </span>
                <h1 class="font-display text-[clamp(1.05rem,2vw,1.25rem)] font-semibold leading-[1.15] text-text-bright">Editor TS</h1>
              </div>

              <div class="mt-[0.2rem] grid gap-[0.45rem]">
                <button type="button" class={primaryButtonClass} onClick={props.onConnectFolder}>
                  {isFolderMode() ? 'Reconnect Folder' : 'Connect Folder'}
                </button>
                <button
                  type="button"
                  class={secondaryButtonClass}
                  disabled={isRemoteMode()}
                  onClick={props.onUseRemoteWorkspace}
                >
                  Use Remote Workspace
                </button>
                <button
                  type="button"
                  class={secondaryButtonClass}
                  disabled={props.workspaceMode === 'demo'}
                  onClick={props.onUseDemoWorkspace}
                >
                  Use Demo Workspace
                </button>
              </div>

              <div class="mt-[0.2rem] flex flex-col gap-[0.3rem] rounded-[4px] border border-line-dim bg-bg-card px-[0.7rem] py-[0.55rem]">
                <div class="inline-flex w-fit items-center gap-[0.35rem] font-mono text-[0.68rem] font-medium text-text-primary">
                  <span class={cx('inline-block h-1.5 w-1.5 rounded-full', statusDotClass())} />
                  <span>{workspaceStateLabel()}</span>
                </div>
                <p class="text-[0.68rem] leading-[1.35] text-text-secondary">{props.statusText}</p>
              </div>

              <p class="text-[0.68rem] italic leading-[1.35] text-text-muted">
                Folder mode needs Chromium.
                {!props.fsSupported ? ' This browser does not expose folder picking.' : ''}
              </p>
            </section>
          </div>

          <nav class="sidebar-nav grid shrink-0 grid-cols-3 border-b border-line-dim max-md:grid-cols-1" aria-label="Sidebar sections">
            <button type="button" class={sidebarTabClass(activeSidebarTab() === 'workspace')} aria-pressed={activeSidebarTab() === 'workspace'} onClick={() => setActiveSidebarTab('workspace')}>Workspace</button>
            <button type="button" class={sidebarTabClass(activeSidebarTab() === 'ai')} aria-pressed={activeSidebarTab() === 'ai'} onClick={() => setActiveSidebarTab('ai')}>AI</button>
            <button type="button" class={sidebarTabClass(activeSidebarTab() === 'structure')} aria-pressed={activeSidebarTab() === 'structure'} onClick={() => setActiveSidebarTab('structure')}>Structure</button>
          </nav>

          <div class="sidebar-scrollable flex-1 overflow-y-auto overflow-x-hidden p-[0.65rem]">
            <div class="sidebar-panels flex flex-col">
              <div class="sidebar-panel flex flex-col gap-[0.75rem]" hidden={activeSidebarTab() !== 'workspace'}>
                <section class={cardClass}>
                  <strong class={sectionTitleClass}>Pages</strong>
                  <div id="pages-container" />
                </section>

                <section class={cardClass}>
                  <strong class={sectionTitleClass}>Selected</strong>
                  <div id="selected-info" />
                </section>

                <section class={cardClass}>
                  <strong class={sectionTitleClass}>Stats</strong>
                  <div id="stats-container" />
                </section>
              </div>

              <div class="sidebar-panel flex flex-col gap-[0.75rem]" hidden={activeSidebarTab() !== 'ai'}>
                <AiConnectionPanel aiBaseUrl={props.aiBaseUrl} onAiBaseUrlChange={props.onAiBaseUrlChange} />
              </div>

              <div class="sidebar-panel flex flex-col gap-[0.75rem]" hidden={activeSidebarTab() !== 'structure'}>
                <section class={cardClass}>
                  <strong class={sectionTitleClass}>Layers</strong>
                  <div id="layers-container" />
                </section>

                <section class={cardClass}>
                  <strong class={sectionTitleClass}>Components</strong>
                  <div id="component-palette" />
                </section>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main class="content flex min-h-screen min-w-0 flex-col gap-[0.65rem] overflow-auto bg-bg-void p-[0.95rem] max-lg:min-h-[50vh] max-lg:overflow-visible">
        <div class="tabs flex flex-wrap">
          <button id="tab-chat" type="button" class={mainTabClass(activeMainTab() === 'chat')} aria-pressed={activeMainTab() === 'chat'} onClick={() => setActiveMainTab('chat')}>Chat</button>
          <button id="tab-editor" type="button" class={mainTabClass(activeMainTab() === 'editor')} aria-pressed={activeMainTab() === 'editor'} onClick={() => setActiveMainTab('editor')}>Editor</button>
          <button id="tab-code" type="button" class={mainTabClass(activeMainTab() === 'code')} aria-pressed={activeMainTab() === 'code'} onClick={() => setActiveMainTab('code')}>Code</button>
        </div>

        <AiWorkspacePanel hidden={activeMainTab() !== 'chat'} />

        <div class="workspace-stage flex min-h-0 flex-1 flex-col gap-[0.8rem]" hidden={activeMainTab() === 'chat'}>
          <iframe id="preview-iframe" class="editorts-preview-frame preview-frame w-full flex-1 rounded-[8px] border border-line-dim bg-white" title="Editor preview" />

          <div class="editorts-code-tabs code-tabs">
            <button id="code-tab-files" type="button">Files</button>
            <button id="code-tab-viewer" type="button">View</button>
            <button id="code-tab-js" type="button">JS</button>
            <button id="code-tab-css" type="button">CSS</button>
            <button id="code-tab-json" type="button">JSON</button>
            <button id="code-tab-jsx" type="button">JSX</button>
          </div>

          <div class="editorts-code-panels code-panels min-h-0 flex-1 rounded-[8px] border border-line-dim bg-bg-elevated p-[1rem]">
            <div class="flex h-full min-h-0 flex-col gap-2">
              <div id="files-viewer-container" class="min-h-0 flex-1" />
              <div id="viewer-editor-container" class="min-h-0 flex-1" />
              <div id="js-editor-container" class="min-h-0 flex-1" />
              <div id="css-editor-container" class="min-h-0 flex-1" />
              <div id="json-editor-container" class="min-h-0 flex-1" />
              <div id="jsx-editor-container" class="min-h-0 flex-1" />
            </div>
          </div>
        </div>
      </main>

      <div
        id="command-palette"
        role="dialog"
        aria-modal="true"
        aria-hidden="true"
        style="display:none;"
        class="fixed inset-0 z-[1200] items-start justify-center bg-[rgba(6,8,14,0.65)] px-4 pt-[12vh] backdrop-blur-sm"
      >
        <div class="flex w-full max-w-[520px] flex-col gap-2 rounded-lg border border-line-soft bg-bg-elevated p-4 shadow-[0_18px_45px_rgba(0,0,0,0.4)]">
          <div class="flex items-center justify-between gap-2">
            <div class="flex flex-col gap-1">
              <div id="command-palette-title" class="font-mono text-[13px] font-semibold text-text-primary">Command Palette</div>
              <div class="font-mono text-[11px] text-text-muted">Add a component or run a command.</div>
            </div>
            <button id="command-palette-close" type="button" class="inline-flex items-center justify-center rounded-sm border border-line-soft px-2.5 py-1 font-mono text-[11px] text-text-secondary transition hover:border-line-mid hover:bg-white/4 hover:text-text-primary">x</button>
          </div>
          <input
            id="command-palette-input"
            type="text"
            placeholder="Search components..."
            aria-labelledby="command-palette-title"
            class={fieldInputClass}
          />
          <div id="command-palette-results" role="listbox" class="flex max-h-80 flex-col gap-1 overflow-auto" />
          <div id="command-palette-hint" class="font-mono text-[10px] text-text-muted">Press Enter to add to selected or to the page root.</div>
        </div>
      </div>
    </div>
  );
}
