import { SHARED_AI_UI_IDS } from './aiIds';

type AiConnectionPanelProps = {
  aiBaseUrl: string;
  onAiBaseUrlChange: (value: string) => void;
  baseUrlPlaceholder?: string;
  healthHelpText?: string;
  footerText?: string;
};

type AiWorkspacePanelProps = {
  promptPlaceholder?: string;
  modelHelpText?: string;
  emptyDiffMessage?: string;
  sendLabel?: string;
  applyLabel?: string;
  newSessionLabel?: string;
  resetSessionLabel?: string;
  hidden?: boolean;
};

export function AiConnectionPanel(props: AiConnectionPanelProps) {
  return (
    <section class="shared-ai-card shared-ai-connection-card">
      <div class="shared-ai-header">
        <strong class="shared-ai-section-title">AI connection</strong>
        <a
          id={SHARED_AI_UI_IDS.link}
          href="#"
          target="_blank"
          rel="noopener noreferrer"
          class="shared-ai-link"
        >
          Open chats
        </a>
      </div>

      <label class="shared-ai-field">
        <span class="shared-ai-field-caption">OpenCode base URL</span>
        <input
          id={SHARED_AI_UI_IDS.baseUrlInput}
          type="text"
          value={props.aiBaseUrl}
          onInput={(event) => props.onAiBaseUrlChange(event.currentTarget.value)}
          placeholder={props.baseUrlPlaceholder ?? 'http://127.0.0.1:4096'}
          class="shared-ai-input"
        />
      </label>

      <p class="shared-ai-copy">
        {props.healthHelpText ?? 'Run `opencode serve --port 4096 --cors https://your-app.example.com` on the same machine as your browser.'}
      </p>

      <div class="shared-ai-actions">
        <button id={SHARED_AI_UI_IDS.healthButton} type="button" class="shared-ai-button shared-ai-button-secondary">
          Check health
        </button>
      </div>

      <pre id={SHARED_AI_UI_IDS.healthStatus} class="shared-ai-status-pre" />
      <p class="shared-ai-copy">
        {props.footerText ?? 'Use the main Chat tab for session history and the full conversation workspace.'}
      </p>
    </section>
  );
}

export function AiWorkspacePanel(props: AiWorkspacePanelProps) {
  return (
    <section class="shared-ai-workspace" hidden={props.hidden}>
      <aside class="shared-ai-card shared-ai-sessions">
        <div class="shared-ai-header">
          <strong class="shared-ai-section-title">Sessions</strong>
          <div class="shared-ai-actions">
            <button id={SHARED_AI_UI_IDS.sessionNewButton} type="button" class="shared-ai-button shared-ai-button-small shared-ai-button-secondary">
              {props.newSessionLabel ?? 'New'}
            </button>
            <button id={SHARED_AI_UI_IDS.sessionResetButton} type="button" class="shared-ai-button shared-ai-button-small shared-ai-button-secondary">
              {props.resetSessionLabel ?? 'Reset'}
            </button>
          </div>
        </div>

        <div id={SHARED_AI_UI_IDS.sessionList} class="shared-ai-session-list" />
      </aside>

      <div class="shared-ai-stage">
        <div class="shared-ai-card shared-ai-toolbar-card">
          <div class="shared-ai-header">
            <strong class="shared-ai-section-title">OpenCode chat</strong>
            <div class="shared-ai-actions">
              <button
                id={SHARED_AI_UI_IDS.chatApplyButton}
                type="button"
                class="shared-ai-button shared-ai-button-small shared-ai-button-secondary"
                disabled
              >
                {props.applyLabel ?? 'Apply Diff'}
              </button>
            </div>
          </div>

          <div class="shared-ai-toolbar-meta">
            <label class="shared-ai-field shared-ai-model-field">
              <span class="shared-ai-field-caption">Model</span>
              <select id={SHARED_AI_UI_IDS.modelSelect} class="shared-ai-input" />
            </label>

            <p class="shared-ai-copy">
              {props.modelHelpText ?? '`OpenCode Zen` routes through OpenCode-managed models. `OpenAI auth` uses your connected OpenAI or ChatGPT access inside OpenCode.'}
            </p>

            <div
              id={SHARED_AI_UI_IDS.chatStatus}
              class="shared-ai-chat-status"
              data-state="idle"
              aria-live="polite"
            >
              Ready
            </div>
          </div>
        </div>

        <div
          id={SHARED_AI_UI_IDS.chatRoot}
          data-editorts-ai-chat-root
          class="shared-ai-root"
        >
          <pre id={SHARED_AI_UI_IDS.chatLog} class="shared-ai-chat-log" />

          <section class="shared-ai-card shared-ai-diff-card">
            <div class="shared-ai-header">
              <strong class="shared-ai-section-title">Pending diff</strong>
              <span id={SHARED_AI_UI_IDS.diffSummary} class="shared-ai-diff-summary">
                Awaiting AI changes
              </span>
            </div>

            <div id={SHARED_AI_UI_IDS.diffViewer} class="shared-ai-diff-viewer">
              <div data-ai-diff-empty="true" class="shared-ai-diff-empty">
                {props.emptyDiffMessage ?? 'Generate a reply with file replacements to inspect it here before applying.'}
              </div>
            </div>
          </section>

          <section class="shared-ai-card shared-ai-compose-card">
            <label class="shared-ai-field">
              <span class="shared-ai-field-caption">Prompt</span>
              <textarea
                id={SHARED_AI_UI_IDS.chatInput}
                class="shared-ai-textarea"
                placeholder={props.promptPlaceholder ?? 'Ask OpenCode to refactor the hero, tune CSS, or update project files...'}
              />
            </label>

            <div class="shared-ai-actions">
              <button id={SHARED_AI_UI_IDS.chatSendButton} type="button" class="shared-ai-button shared-ai-button-primary">
                {props.sendLabel ?? 'Generate Diff'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
