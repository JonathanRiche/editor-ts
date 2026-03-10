import type { OpencodeClient, Part, Event, Message, TextPart } from '@opencode-ai/sdk';
import type { Page } from './Page';
import type { EditorTsAiChatReplacement, EditorTsAiChatResult } from '../types';

type ParsedChatResponse = {
  replacements?: Array<{
    path?: unknown;
    content?: unknown;
    content_b64?: unknown;
  }>;
};

const stripCodeFences = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
};

const extractJsonFromText = (text: string): string | null => {
  const trimmed = text.trim();

  // Prefer fenced JSON blocks.
  const fenceStart = trimmed.indexOf('```');
  if (fenceStart >= 0) {
    const fenceLangEnd = trimmed.indexOf('\n', fenceStart);
    const contentStart = fenceLangEnd >= 0 ? fenceLangEnd + 1 : fenceStart + 3;
    const fenceEnd = trimmed.indexOf('```', contentStart);
    if (fenceEnd > contentStart) {
      const inner = trimmed.slice(contentStart, fenceEnd).trim();
      if (inner.startsWith('{') || inner.startsWith('[')) {
        return inner;
      }
    }
  }

  // Fallback: scan for the first valid JSON object/array within the text.
  const tryParseSlice = (slice: string): boolean => {
    try {
      JSON.parse(slice);
      return true;
    } catch {
      return false;
    }
  };

  const scan = (open: '{' | '[', close: '}' | ']'): string | null => {
    let depth = 0;
    let start: number | null = null;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i] ?? '';

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === open) {
        if (depth === 0) start = i;
        depth++;
        continue;
      }

      if (ch === close && depth > 0) {
        depth--;
        if (depth === 0 && start !== null) {
          const slice = trimmed.slice(start, i + 1);
          if (tryParseSlice(slice)) return slice;
          start = null;
        }
      }
    }

    return null;
  };

  return scan('{', '}') ?? scan('[', ']');
};

const decodeBase64ToString = (b64: string): string => {
  const normalized = b64
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  // Browser-safe base64 decode
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
};

export const parseAiChatResponse = (assistantText: string, sessionId: string): EditorTsAiChatResult => {
  const rawText = assistantText;

  const extracted = extractJsonFromText(assistantText);
  const jsonText = extracted ?? stripCodeFences(assistantText);

  const parsed = JSON.parse(jsonText) as ParsedChatResponse;
  const rawReplacements = Array.isArray(parsed.replacements) ? parsed.replacements : [];

  const replacements: EditorTsAiChatReplacement[] = [];
  for (const item of rawReplacements) {
    const path = typeof item?.path === 'string' ? item.path : null;
    if (!path) continue;

    if (typeof item?.content_b64 === 'string') {
      try {
        replacements.push({ path, content: decodeBase64ToString(item.content_b64) });
      } catch {
        replacements.push({ path, content: item.content_b64 });
      }
      continue;
    }

    if (typeof item?.content === 'string') {
      replacements.push({ path, content: item.content });
      continue;
    }
  }

  return { replacements, rawText, sessionId };
};

export const buildAiChatSystemPrompt = (): string => {
  return buildAiChatSystemPromptWithOptions();
};

export const buildAiChatSystemPromptWithOptions = (options?: {
  allowedPaths?: string[];
}): string => {
  const allowedPaths = Array.isArray(options?.allowedPaths)
    ? options.allowedPaths.filter((path) => path.trim().length > 0)
    : ['page.json', 'styles.css', 'components/<id>.js'];

  const allowedPathLine = allowedPaths.length > 0
    ? `Allowed paths: ${allowedPaths.join(', ')}`
    : 'Allowed paths: (none)';

  return [
    'You are an automated assistant integrated with EditorTs.',
    'Return JSON only. No markdown. No backticks. No commentary.',
    'Schema: { "replacements": [{ "path": string, "content_b64": string }] }',
    'Always use content_b64 (base64 of full UTF-8 file contents).',
    allowedPathLine,
    '',
    'IMPORTANT CSS RULES:',
    '- When writing styles.css, use valid CSS selectors.',
    '- IDs must be prefixed with # (e.g. #hero-1, #hero-title).',
  ].join('\n');
};

export const buildAiChatSnapshot = (pageJson: string, css: string, componentScripts: Record<string, string>): string => {
  const files: Record<string, string> = {
    'page.json': pageJson,
    'styles.css': css,
  };

  Object.entries(componentScripts).forEach(([path, content]) => {
    files[path] = content;
  });

  return buildAiChatSnapshotFromFiles(files, { derivedPaths: ['index.html'] });
};

export const buildAiChatSnapshotFromFiles = (
  files: Record<string, string>,
  options?: {
    derivedPaths?: string[];
    readOnlyPaths?: string[];
  }
): string => {
  const sortedPaths = Object.keys(files).sort((a, b) => a.localeCompare(b));
  const derivedPathSet = new Set(options?.derivedPaths ?? []);
  const readOnlyPathSet = new Set(options?.readOnlyPaths ?? []);

  const treeLines = sortedPaths.length > 0
    ? sortedPaths.map((path) => {
      const labels: string[] = [];
      if (derivedPathSet.has(path)) labels.push('derived');
      if (readOnlyPathSet.has(path)) labels.push('read-only');
      const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
      return `- ${path}${suffix}`;
    }).join('\n')
    : '- (none)';

  const fileBlocks = sortedPaths.length > 0
    ? sortedPaths.map((path) => `${path}:\n${files[path] ?? ''}`).join('\n\n')
    : '(no file content)';

  return [
    'WORKSPACE TREE:',
    treeLines,
    '',
    'FILES:',
    fileBlocks,
  ].join('\n');
};

export const normalizeOpencodeModelId = (providerID: string, modelID: string): string => {
  if (providerID !== 'opencode') return modelID;
  if (modelID === 'claude-sonnet-4-5-20250929') return 'claude-sonnet-4-5';
  return modelID;
};

export const chooseChatModel = async (client: OpencodeClient): Promise<{ providerID: string; modelID: string } | undefined> => {
  const configResult = await client.config.get();
  const configured = configResult.data?.model;
  if (configured) {
    const [providerID, ...rest] = configured.split('/');
    if (providerID && rest.length > 0) {
      const modelID = rest.join('/');
      return { providerID, modelID: normalizeOpencodeModelId(providerID, modelID) };
    }
  }

  const providersResult = await client.config.providers();
  if (!providersResult.data) return undefined;

  const modelID = providersResult.data.default?.opencode;
  if (modelID) return { providerID: 'opencode', modelID };

  return undefined;
};

export const requestAiReplacements = async (args: {
  client: OpencodeClient;
  prompt: string;
  pageJson?: string;
  css?: string;
  componentScripts?: Record<string, string>;
  workspaceFiles?: Record<string, string>;
  allowedPaths?: string[];
  derivedPaths?: string[];
  readOnlyPaths?: string[];
  sessionId?: string;
  sessionTitle?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  stream?: boolean;
  onStream?: (delta: string) => void;
}): Promise<EditorTsAiChatResult> => {
  const {
    client,
    prompt,
    pageJson,
    css,
    componentScripts,
    workspaceFiles,
    allowedPaths,
    derivedPaths,
    readOnlyPaths,
    sessionId: existingSessionId,
    sessionTitle,
    model: selectedModel,
    stream,
    onStream,
  } = args;

  let sessionId = existingSessionId;

  if (!sessionId) {
    const sessionResult = await client.session.create({ body: { title: sessionTitle ?? 'EditorTs Chat' } });
    if (!sessionResult.data) {
      throw new Error(`Failed to create session: ${String(sessionResult.error)}`);
    }
    sessionId = sessionResult.data.id;
  }

  const normalizedWorkspaceFiles = workspaceFiles ?? {
    'page.json': pageJson ?? '',
    'styles.css': css ?? '',
    ...(componentScripts ?? {}),
  };

  const normalizedAllowedPaths = allowedPaths
    ?? Object.keys(normalizedWorkspaceFiles).sort((a, b) => a.localeCompare(b));

  const system = buildAiChatSystemPromptWithOptions({
    allowedPaths: normalizedAllowedPaths,
  });
  const snapshot = buildAiChatSnapshotFromFiles(normalizedWorkspaceFiles, {
    derivedPaths,
    readOnlyPaths,
  });
  const requestText = [
    system,
    '',
    snapshot,
    '',
    'REQUEST:',
    prompt,
  ].join('\n');

  const model = selectedModel ?? await chooseChatModel(client);

  if (stream && typeof onStream === 'function') {
    // Subscribe before sending so we do not miss early assistant deltas.
    const events = await client.event.subscribe();

    const sendResult = await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        ...(model ? { model } : {}),
        tools: { '*': false },
        parts: [
          { type: 'text', text: requestText },
        ],
      },
    });

    if (sendResult.error) {
      throw new Error(`Prompt failed: ${String(sendResult.error)}`);
    }

    let assembled = '';
    let targetSessionId: string | null = null;
    let targetMessageId: string | null = null;
    let doneMessageId: string | null = null;

    const isMessage = (value: unknown): value is Message => {
      if (!value || typeof value !== 'object') return false;
      return typeof (value as { id?: unknown }).id === 'string' && typeof (value as { role?: unknown }).role === 'string';
    };

    const isTextPart = (value: unknown): value is TextPart => {
      if (!value || typeof value !== 'object') return false;
      return (value as { type?: unknown }).type === 'text' && typeof (value as { text?: unknown }).text === 'string';
    };

    const isEventMessageUpdated = (value: unknown): value is Extract<Event, { type: 'message.updated' }> => {
      if (!value || typeof value !== 'object') return false;
      return (value as { type?: unknown }).type === 'message.updated';
    };

    const isEventMessagePartUpdated = (value: unknown): value is Extract<Event, { type: 'message.part.updated' }> => {
      if (!value || typeof value !== 'object') return false;
      return (value as { type?: unknown }).type === 'message.part.updated';
    };

    const waitForResult = async (): Promise<string> => {
      // Bound the streaming loop so we don't hang forever if the connection dies.
      const timeoutMs = 90_000;
      const timeoutAt = Date.now() + timeoutMs;
      let timedOut = false;

      for await (const payload of events.stream) {
        if (Date.now() > timeoutAt) {
          timedOut = true;
          break;
        }

        const globalEvent = payload as unknown;
        const wrappedPayload = (globalEvent as { payload?: unknown }).payload;
        const eventPayload = wrappedPayload && typeof wrappedPayload === 'object'
          ? wrappedPayload
          : globalEvent;
        if (!eventPayload || typeof eventPayload !== 'object') continue;

        if (isEventMessageUpdated(eventPayload)) {
          const info = (eventPayload as { properties?: unknown }).properties as { info?: unknown } | undefined;
          if (!info || !isMessage(info.info)) continue;

          const msg = info.info;

          // Track the first assistant message for this session that has a completion.
          if (msg.role === 'assistant' && typeof msg.sessionID === 'string' && msg.sessionID === sessionId) {
            targetSessionId = msg.sessionID;
            targetMessageId = msg.id;

            // We only know we're done once the assistant message has completed.
            const completed = (msg as { time?: { completed?: number } }).time?.completed;
            if (typeof completed === 'number') {
              doneMessageId = msg.id;
              break;
            }
          }
        }

        if (isEventMessagePartUpdated(eventPayload)) {
          const properties = (eventPayload as { properties?: unknown }).properties as { part?: unknown; delta?: unknown } | undefined;
          if (!properties) continue;

          const part = properties.part;
          if (!isTextPart(part)) continue;

          const rawSessionId = (part as { sessionID?: unknown }).sessionID;
          const partSessionId = typeof rawSessionId === 'string' ? rawSessionId : null;
          const rawMessageId = (part as { messageID?: unknown }).messageID;
          const partMessageId = typeof rawMessageId === 'string' ? rawMessageId : null;

          // Ignore deltas until we've identified the assistant message for this session.
          if (!targetMessageId) continue;
          if (targetSessionId && partSessionId && partSessionId !== targetSessionId) continue;
          if (partMessageId !== targetMessageId) continue;

          const delta = typeof properties.delta === 'string' ? properties.delta : null;
          if (delta && delta.length > 0) {
            assembled += delta;
            onStream(delta);
            continue;
          }

          // Some servers may send the full text instead of delta.
          if (typeof part.text === 'string' && part.text.length > assembled.length) {
            const next = part.text.slice(assembled.length);
            assembled = part.text;
            if (next.length > 0) {
              onStream(next);
            }
          }
        }
      }

      // If we didn't gather anything via deltas, fetch full message parts as fallback.
      const fallbackMessageId = doneMessageId ?? targetMessageId;
      if (!assembled.trim() && fallbackMessageId) {
        const message = await client.session.message({ path: { id: sessionId, messageID: fallbackMessageId } });
        if (!message.data) {
          throw new Error(`Failed to fetch message: ${String(message.error)}`);
        }
        const parts = Array.isArray(message.data.parts) ? (message.data.parts as Part[]) : [];
        assembled = parts
          .filter((p) => p.type === 'text')
          .map((p) => (p.type === 'text' ? p.text ?? '' : ''))
          .join('');
      }

      if (!assembled.trim() && timedOut) {
        throw new Error('Streaming timed out waiting for assistant response.');
      }

      return assembled;
    };

    const assistantText = await waitForResult();

    if (!assistantText.trim()) {
      throw new Error('No assistant text returned.');
    }

    return parseAiChatResponse(assistantText, sessionId);
  }

  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      ...(model ? { model } : {}),
      tools: { '*': false },
      parts: [
        { type: 'text', text: requestText },
      ],
    },
  });

  if (!result.data) {
    throw new Error(`Prompt failed: ${String(result.error)}`);
  }

  const parts = Array.isArray(result.data.parts) ? (result.data.parts as Part[]) : [];
  const assistantText = parts
    .filter((p) => p.type === 'text')
    .map((p) => (p.type === 'text' ? p.text ?? '' : ''))
    .join('');

  if (!assistantText.trim()) {
    throw new Error('No assistant text returned.');
  }

  return parseAiChatResponse(assistantText, sessionId);
};

export const applyAiReplacementsToPage = async (args: {
  page: Page;
  replacements: EditorTsAiChatReplacement[];
  saveJson: (json: string) => Promise<void>;
  saveCss: (css: string) => Promise<void>;
  saveComponentScript: (id: string, script: string) => Promise<void>;
}): Promise<void> => {
  const { replacements, saveJson, saveCss, saveComponentScript } = args;

  for (const r of replacements) {
    if (r.path === 'page.json') {
      await saveJson(r.content);
      continue;
    }

    if (r.path === 'styles.css') {
      await saveCss(r.content);
      continue;
    }

    if (r.path.startsWith('components/') && r.path.endsWith('.js')) {
      const id = r.path.slice('components/'.length, -3);
      await saveComponentScript(id, r.content);
    }
  }
};

export const applyAiReplacementsToFiles = async (args: {
  replacements: EditorTsAiChatReplacement[];
  saveFile: (path: string, content: string) => Promise<void>;
  isPathAllowed?: (path: string) => boolean;
}): Promise<{ appliedPaths: string[]; skippedPaths: string[] }> => {
  const { replacements, saveFile, isPathAllowed } = args;
  const appliedPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const replacement of replacements) {
    if (isPathAllowed && !isPathAllowed(replacement.path)) {
      skippedPaths.push(replacement.path);
      continue;
    }

    await saveFile(replacement.path, replacement.content);
    appliedPaths.push(replacement.path);
  }

  return { appliedPaths, skippedPaths };
};
