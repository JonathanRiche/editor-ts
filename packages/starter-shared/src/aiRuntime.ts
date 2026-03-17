import {
  extractAiReplacementPaths,
} from 'editor-ts';
import type { EditorTsEditor } from 'editor-ts';
import { SHARED_AI_UI_IDS } from './aiIds';

type SupportedDiffLanguage =
  | 'css'
  | 'json'
  | 'html'
  | 'jsx'
  | 'tsx'
  | 'typescript'
  | 'javascript'
  | 'text';

type AiReplacement = {
  path: string;
  content: string;
};

type AiDiffPreviewOptions = {
  viewerId?: string;
  summaryId?: string;
};

const normalizePath = (path: string): string => path.replace(/^\.\//, '').replace(/\\/g, '/');

const inferDiffLanguage = (path: string): SupportedDiffLanguage => {
  const normalized = normalizePath(path).toLowerCase();

  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.html')) return 'html';
  if (normalized.endsWith('.jsx')) return 'jsx';
  if (normalized.endsWith('.tsx')) return 'tsx';
  if (normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) return 'javascript';

  return 'text';
};

export const loadStoredAiBaseUrl = (storageKey: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(storageKey)?.trim();
  return stored && stored.length > 0 ? stored : fallback;
};

export const persistAiBaseUrl = (storageKey: string, value: string): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, value);
};

const setAiDiffSummary = (summaryId: string, text: string): void => {
  const summary = document.getElementById(summaryId);
  if (summary) {
    summary.textContent = text;
  }
};

export const setAiDiffEmptyState = (
  message: string,
  summary = 'Awaiting AI changes',
  options?: AiDiffPreviewOptions,
): void => {
  const viewerId = options?.viewerId ?? SHARED_AI_UI_IDS.diffViewer;
  const summaryId = options?.summaryId ?? SHARED_AI_UI_IDS.diffSummary;
  const viewer = document.getElementById(viewerId);
  if (!viewer) return;

  viewer.innerHTML = '';

  const empty = document.createElement('div');
  empty.dataset.aiDiffEmpty = 'true';
  empty.className = 'shared-ai-diff-empty';
  empty.textContent = message;
  viewer.appendChild(empty);

  setAiDiffSummary(summaryId, summary);
};

const renderBasicAiDiffPreview = async (
  instance: EditorTsEditor,
  replacements: AiReplacement[],
  options?: AiDiffPreviewOptions,
): Promise<void> => {
  const viewerId = options?.viewerId ?? SHARED_AI_UI_IDS.diffViewer;
  const summaryId = options?.summaryId ?? SHARED_AI_UI_IDS.diffSummary;
  const viewer = document.getElementById(viewerId);
  if (!viewer) return;

  viewer.innerHTML = '';

  if (replacements.length === 0) {
    setAiDiffEmptyState(
      'The last reply did not include editable file replacements.',
      'No pending changes',
      options,
    );
    return;
  }

  const resolved = await Promise.all(
    replacements.map(async (replacement) => ({
      path: replacement.path,
      before: (await instance.content.adapter.readFile(replacement.path)) ?? '',
      after: replacement.content,
      language: inferDiffLanguage(replacement.path),
    })),
  );

  resolved.forEach((file) => {
    const wrapper = document.createElement('article');
    wrapper.className = 'shared-ai-diff-file';

    const header = document.createElement('div');
    header.className = 'shared-ai-diff-file-header';

    const path = document.createElement('span');
    path.className = 'shared-ai-diff-file-path';
    path.textContent = file.path;

    const language = document.createElement('span');
    language.className = 'shared-ai-diff-file-language';
    language.textContent = file.language;

    header.append(path, language);

    const columns = document.createElement('div');
    columns.className = 'shared-ai-diff-columns';

    const beforeColumn = document.createElement('section');
    beforeColumn.className = 'shared-ai-diff-column';

    const beforeLabel = document.createElement('span');
    beforeLabel.className = 'shared-ai-diff-label';
    beforeLabel.textContent = 'Before';

    const beforePre = document.createElement('pre');
    beforePre.className = 'shared-ai-diff-code';
    beforePre.textContent = file.before;

    beforeColumn.append(beforeLabel, beforePre);

    const afterColumn = document.createElement('section');
    afterColumn.className = 'shared-ai-diff-column';

    const afterLabel = document.createElement('span');
    afterLabel.className = 'shared-ai-diff-label';
    afterLabel.textContent = 'After';

    const afterPre = document.createElement('pre');
    afterPre.className = 'shared-ai-diff-code';
    afterPre.textContent = file.after;

    afterColumn.append(afterLabel, afterPre);
    columns.append(beforeColumn, afterColumn);

    wrapper.append(header, columns);
    viewer.appendChild(wrapper);
  });

  setAiDiffSummary(summaryId, `${resolved.length} pending change${resolved.length === 1 ? '' : 's'}`);
};

const formatAiStreamingPathSummary = (paths: string[]): string => {
  if (paths.length === 0) {
    return 'AI changes are streaming. The diff preview will appear when the response completes.';
  }

  if (paths.length <= 3) {
    return `Streaming AI changes for ${paths.join(', ')}. The diff preview will appear when the response completes.`;
  }

  return `Streaming AI changes for ${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more file(s). The diff preview will appear when the response completes.`;
};

export const installAiDiffPreview = (
  instance: EditorTsEditor,
  options?: AiDiffPreviewOptions,
): void => {
  const ai = instance.ai;
  if (!ai) {
    setAiDiffEmptyState('AI is disabled for this workspace.', 'AI unavailable', options);
    return;
  }

  const originalChat = ai.chat.bind(ai);
  const originalApply = ai.apply.bind(ai);
  const originalSetCurrent = ai.sessions.setCurrent.bind(ai.sessions);
  const originalReset = ai.sessions.reset.bind(ai.sessions);

  ai.chat = async (prompt, chatOptions) => {
    let streamedText = '';
    let lastStreamSignature = '';
    const shouldStream = chatOptions?.stream ?? true;

    if (shouldStream) {
      setAiDiffEmptyState(
        'AI changes are streaming. The diff preview will appear when the response completes.',
        'Receiving AI changes',
        options,
      );
    }

    const result = await originalChat(prompt, {
      ...chatOptions,
      onStream: shouldStream
        ? (delta) => {
          streamedText += delta;
          const streamedPaths = extractAiReplacementPaths(streamedText);
          const nextSummary = streamedPaths.length > 0
            ? `Receiving ${streamedPaths.length} pending change${streamedPaths.length === 1 ? '' : 's'}`
            : 'Receiving AI changes';
          const nextMessage = formatAiStreamingPathSummary(streamedPaths);
          const nextSignature = `${nextSummary}|${nextMessage}`;

          if (nextSignature !== lastStreamSignature) {
            lastStreamSignature = nextSignature;
            setAiDiffEmptyState(nextMessage, nextSummary, options);
          }

          chatOptions?.onStream?.(delta);
        }
        : chatOptions?.onStream,
    });

    await renderBasicAiDiffPreview(instance, result.replacements, options);
    return result;
  };

  ai.apply = async (replacements) => {
    await originalApply(replacements);
    setAiDiffEmptyState(
      replacements.length > 0
        ? `Applied ${replacements.length} change${replacements.length === 1 ? '' : 's'}. Generate another reply to preview the next patch.`
        : 'Generate a reply with file replacements to inspect it here before applying.',
      replacements.length > 0 ? 'Applied' : 'Awaiting AI changes',
      options,
    );
  };

  ai.sessions.setCurrent = async (sessionId) => {
    await originalSetCurrent(sessionId);
    setAiDiffEmptyState(
      'Select or generate a reply in this session to preview its file changes.',
      sessionId ? 'Session loaded' : 'Awaiting AI changes',
      options,
    );
  };

  ai.sessions.reset = async () => {
    await originalReset();
    setAiDiffEmptyState(
      'Generate a reply with file replacements to inspect it here before applying.',
      'Awaiting AI changes',
      options,
    );
  };
};
