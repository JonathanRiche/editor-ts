import type { OpencodeClient, Part, Message, Event } from '@opencode-ai/sdk/client';
import type { Page } from './Page';
import type { EditorTsAiChatReplacement, EditorTsAiChatResult } from '../types';
import { normalizeOpencodeModelId, parseAiModelRef } from './aiModels';

export { normalizeOpencodeModelId } from './aiModels';

type ParsedChatResponse = {
  replacements?: Array<{
    path?: unknown;
    content?: unknown;
    content_b64?: unknown;
  }>;
};

const AI_CHAT_REQUEST_MARKER = 'REQUEST:\n';

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

export const extractAiChatRequestText = (messageText: string): string => {
  const normalized = messageText.replace(/\r\n/g, '\n');
  const markerIndex = normalized.lastIndexOf(AI_CHAT_REQUEST_MARKER);

  if (markerIndex >= 0) {
    const extracted = normalized.slice(markerIndex + AI_CHAT_REQUEST_MARKER.length).trim();
    if (extracted) {
      return extracted;
    }
  }

  return stripCodeFences(normalized).trim();
};

export const extractAiReplacementPaths = (assistantText: string): string[] => {
  const pushUnique = (out: string[], path: string) => {
    if (!out.includes(path)) {
      out.push(path);
    }
  };

  const extracted = extractJsonFromText(assistantText);
  const jsonText = extracted ?? stripCodeFences(assistantText);

  try {
    const parsed = JSON.parse(jsonText) as ParsedChatResponse;
    const rawReplacements = Array.isArray(parsed.replacements) ? parsed.replacements : [];
    const paths: string[] = [];

    rawReplacements.forEach((item) => {
      if (typeof item?.path === 'string' && item.path.trim()) {
        pushUnique(paths, item.path);
      }
    });

    if (paths.length > 0) {
      return paths;
    }
  } catch {
    // Fall through to regex extraction for partial stream payloads.
  }

  const paths: string[] = [];
  const pathPattern = /"path"\s*:\s*"([^"]+)"/g;

  for (const match of assistantText.matchAll(pathPattern)) {
    const path = match[1]?.trim();
    if (path) {
      pushUnique(paths, path);
    }
  }

  return paths;
};

export const summarizeAiAssistantText = (assistantText: string): string => {
  const trimmed = assistantText.trim();
  if (!trimmed) return '';

  try {
    const parsed = parseAiChatResponse(assistantText, 'display');
    const paths = Array.from(new Set(parsed.replacements.map((replacement) => replacement.path)));

    if (paths.length > 0) {
      const intro = `Prepared ${paths.length} file change${paths.length === 1 ? '' : 's'}.`;
      return [
        intro,
        ...paths.map((path) => `- ${path}`),
      ].join('\n');
    }

    if (parsed.warnings && parsed.warnings.length > 0) {
      return [
        'No editable file changes were returned.',
        ...parsed.warnings.map((warning) => `- ${warning}`),
      ].join('\n');
    }

    return 'No editable file changes were returned.';
  } catch {
    return trimmed.length > 800 ? `${trimmed.slice(0, 797)}...` : trimmed;
  }
};

export const parseAiChatResponse = (assistantText: string, sessionId: string): EditorTsAiChatResult => {
  const rawText = assistantText;

  const extracted = extractJsonFromText(assistantText);
  const jsonText = extracted ?? stripCodeFences(assistantText);

  const parsed = JSON.parse(jsonText) as ParsedChatResponse;
  const rawReplacements = Array.isArray(parsed.replacements) ? parsed.replacements : [];

  const replacements: EditorTsAiChatReplacement[] = [];
  const warnings: string[] = [];
  const isValidReplacementContent = (path: string, content: string): boolean => {
    if (path === 'page.json') {
      try {
        JSON.parse(content);
        return true;
      } catch {
        warnings.push(`Skipped invalid JSON replacement for ${path}.`);
        return false;
      }
    }

    return true;
  };

  for (const item of rawReplacements) {
    const path = typeof item?.path === 'string' ? item.path : null;
    if (!path) continue;

    if (typeof item?.content_b64 === 'string') {
      try {
        const content = decodeBase64ToString(item.content_b64);
        if (isValidReplacementContent(path, content)) {
          replacements.push({ path, content });
        }
      } catch {
        warnings.push(`Skipped malformed base64 replacement for ${path}.`);
      }
      continue;
    }

    if (typeof item?.content === 'string') {
      if (isValidReplacementContent(path, item.content)) {
        replacements.push({ path, content: item.content });
      }
      continue;
    }
  }

  return { replacements, rawText, sessionId, warnings };
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

const extractTextFromParts = (parts: Part[]): string => {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
    .join('');
};

const getMessageCreatedAt = (message: Message): number => {
  return typeof message.time?.created === 'number' ? message.time.created : 0;
};

const isAssistantMessageForSession = (
  message: Message,
  sessionId: string,
): message is Extract<Message, { role: 'assistant' }> => {
  return message.role === 'assistant' && message.sessionID === sessionId;
};

const formatStreamError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return 'OpenCode stream failed.';
  }

  if ('data' in error && error.data && typeof error.data === 'object') {
    const data = error.data;
    if ('message' in data && typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }
  }

  if ('message' in error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  if ('name' in error && typeof error.name === 'string' && error.name.trim()) {
    return error.name;
  }

  return 'OpenCode stream failed.';
};

type RawMessagePartDeltaEvent = {
  type: 'message.part.delta';
  properties?: {
    sessionID?: unknown;
    messageID?: unknown;
    partID?: unknown;
    delta?: unknown;
  };
};

const isRawMessagePartDeltaEvent = (event: unknown): event is RawMessagePartDeltaEvent => {
  if (!event || typeof event !== 'object') return false;
  const record = event as { type?: unknown };
  return record.type === 'message.part.delta';
};

const readDeltaEventSessionId = (event: RawMessagePartDeltaEvent): string | null => {
  return typeof event.properties?.sessionID === 'string' && event.properties.sessionID.trim()
    ? event.properties.sessionID
    : null;
};

const readDeltaEventMessageId = (event: RawMessagePartDeltaEvent): string | null => {
  return typeof event.properties?.messageID === 'string' && event.properties.messageID.trim()
    ? event.properties.messageID
    : null;
};

const readDeltaEventText = (event: RawMessagePartDeltaEvent): string => {
  return typeof event.properties?.delta === 'string' ? event.properties.delta : '';
};

const readLatestAssistantMessage = async (args: {
  client: OpencodeClient;
  sessionId: string;
  minCreatedAt: number;
  messageId?: string | null;
}): Promise<{ id: string; text: string; completed: boolean } | null> => {
  const { client, sessionId, minCreatedAt, messageId } = args;

  const messages = await client.session.messages({ path: { id: sessionId }, query: { limit: 50 } });
  const entries = Array.isArray(messages.data)
    ? (messages.data as Array<{ info: Message; parts: Part[] }>)
    : [];

  const assistants = entries
    .filter((entry) => isAssistantMessageForSession(entry.info, sessionId))
    .filter((entry) => getMessageCreatedAt(entry.info) >= minCreatedAt)
    .sort((a, b) => getMessageCreatedAt(b.info) - getMessageCreatedAt(a.info));

  const selected = messageId
    ? assistants.find((entry) => entry.info.id === messageId) ?? assistants[0]
    : assistants[0];

  if (!selected) return null;

  const selectedText = extractTextFromParts(selected.parts);
  if (selectedText.trim()) {
    return {
      id: selected.info.id,
      text: selectedText,
      completed: typeof selected.info.time?.completed === 'number',
    };
  }

  const latestWithText = assistants.find((entry) => {
    return extractTextFromParts(entry.parts).trim().length > 0;
  });

  if (latestWithText) {
    return {
      id: latestWithText.info.id,
      text: extractTextFromParts(latestWithText.parts),
      completed: typeof latestWithText.info.time?.completed === 'number',
    };
  }

  return {
    id: selected.info.id,
    text: selectedText,
    completed: typeof selected.info.time?.completed === 'number',
  };
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const waitForSettledAssistantText = async (args: {
  client: OpencodeClient;
  sessionId: string;
  minCreatedAt: number;
  messageId?: string | null;
  maxWaitMs?: number;
  pollMs?: number;
  settleMs?: number;
}): Promise<string> => {
  const {
    client,
    sessionId,
    minCreatedAt,
    messageId,
    maxWaitMs = 6_000,
    pollMs = 250,
    settleMs = 750,
  } = args;

  const deadline = Date.now() + maxWaitMs;
  let latestText = '';
  let lastSignature = '';
  let stableSince = 0;

  while (Date.now() <= deadline) {
    const latest = await readLatestAssistantMessage({
      client,
      sessionId,
      minCreatedAt,
      messageId,
    });

    if (!latest) {
      await wait(pollMs);
      continue;
    }

    latestText = latest.text;
    const signature = `${latest.id}|${latest.completed ? '1' : '0'}|${latest.text}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      stableSince = Date.now();
    } else if (latest.completed && latest.text.trim().length > 0 && Date.now() - stableSince >= settleMs) {
      return latest.text;
    }

    await wait(pollMs);
  }

  return latestText;
};

export const chooseChatModel = async (client: OpencodeClient): Promise<{ providerID: string; modelID: string } | undefined> => {
  const configResult = await client.config.get();
  const configured = configResult.data?.model;
  if (configured) {
    const parsed = parseAiModelRef(configured);
    if (parsed) return parsed;
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
    const streamStartedAt = Date.now() - 1000;
    const abortController = new AbortController();
    const partTextById = new Map<string, string>();
    let assembled = '';
    let assistantMessageId: string | null = null;
    let assistantMessageHasText = false;
    let timedOut = false;
    let lastStreamFailure: unknown = null;

    const canSwitchTrackedAssistant = (messageId: string): boolean => {
      return assistantMessageId === null
        || assistantMessageId === messageId
        || (!assistantMessageHasText && assembled.trim().length === 0);
    };

    const startTrackingAssistantMessage = (messageId: string) => {
      if (assistantMessageId !== messageId) {
        partTextById.clear();
        assembled = '';
        assistantMessageHasText = false;
      }
      assistantMessageId = messageId;
    };

    const resolveAssistantText = async (): Promise<string> => {
      const latest = await readLatestAssistantMessage({
        client,
        sessionId,
        minCreatedAt: streamStartedAt,
        messageId: assistantMessageId,
      });

      if (latest?.text.trim()) {
        assistantMessageId = latest.id;
        return latest.text;
      }

      if (assembled.trim()) {
        return assembled;
      }

      return '';
    };

    const streamPromise = (async (): Promise<string> => {
      const subscription = await client.event.subscribe({
        signal: abortController.signal,
        onSseError: (error) => {
          lastStreamFailure = error;
        },
      });

      try {
        for await (const event of subscription.stream as AsyncGenerator<Event, unknown, unknown>) {
          if (abortController.signal.aborted) {
            break;
          }

          if (event.type === 'message.updated') {
            const message = event.properties.info;
            if (!isAssistantMessageForSession(message, sessionId)) {
              continue;
            }
            if (getMessageCreatedAt(message) < streamStartedAt) {
              continue;
            }

            if (canSwitchTrackedAssistant(message.id)) {
              startTrackingAssistantMessage(message.id);
            }

            if (message.error) {
              throw new Error(formatStreamError(message.error));
            }

            if (assistantMessageId === message.id && typeof message.time?.completed === 'number') {
              const resolvedText = await waitForSettledAssistantText({
                client,
                sessionId,
                minCreatedAt: streamStartedAt,
                messageId: assistantMessageId,
              });
              if (resolvedText.trim()) {
                return resolvedText;
              }
            }

            continue;
          }

          if (event.type === 'message.part.updated') {
            const { part, delta } = event.properties;
            if (part.sessionID !== sessionId || part.type !== 'text') {
              continue;
            }
            if (!canSwitchTrackedAssistant(part.messageID)) {
              continue;
            }

            startTrackingAssistantMessage(part.messageID);
            const previousText = partTextById.get(part.id) ?? '';
            const currentText = part.text ?? '';
            partTextById.set(part.id, currentText);
            if (currentText.trim().length > 0) {
              assistantMessageHasText = true;
            }

            const nextDelta = typeof delta === 'string'
              ? delta
              : currentText.startsWith(previousText)
                ? currentText.slice(previousText.length)
                : currentText;

            if (nextDelta.length > 0) {
              assembled += nextDelta;
              assistantMessageHasText = true;
              onStream(nextDelta);
            }

            continue;
          }

          if (isRawMessagePartDeltaEvent(event)) {
            const deltaSessionId = readDeltaEventSessionId(event);
            const deltaMessageId = readDeltaEventMessageId(event);
            const deltaText = readDeltaEventText(event);

            if (deltaSessionId !== sessionId || !deltaMessageId) {
              continue;
            }

            if (!canSwitchTrackedAssistant(deltaMessageId)) {
              continue;
            }

            startTrackingAssistantMessage(deltaMessageId);

            if (deltaText.length > 0) {
              assembled += deltaText;
              assistantMessageHasText = true;
              onStream(deltaText);
            }

            continue;
          }

          if (event.type === 'session.error' && event.properties.sessionID === sessionId) {
            throw new Error(formatStreamError(event.properties.error));
          }

          if (event.type === 'session.idle' && event.properties.sessionID === sessionId && (assistantMessageId !== null || assembled.trim())) {
            const resolvedText = await waitForSettledAssistantText({
              client,
              sessionId,
              minCreatedAt: streamStartedAt,
              messageId: assistantMessageId,
            });
            if (resolvedText.trim()) {
              return resolvedText;
            }
          }
        }
      } finally {
        abortController.abort();
      }

      return await waitForSettledAssistantText({
        client,
        sessionId,
        minCreatedAt: streamStartedAt,
        messageId: assistantMessageId,
      });
    })();

    const timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, 90_000);

    let assistantText = '';
    try {
      const sendResult = await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          agent: 'build',
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

      assistantText = await streamPromise;
    } catch (error: unknown) {
      if (timedOut) {
        const fallbackText = await resolveAssistantText();
        if (fallbackText.trim()) {
          assistantText = fallbackText;
        } else {
          const detail = lastStreamFailure ? ` ${formatStreamError(lastStreamFailure)}` : '';
          throw new Error(`Streaming timed out waiting for assistant response.${detail}`);
        }
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
      abortController.abort();
    }

    if (!assistantText.trim()) {
      throw new Error('No assistant text returned.');
    }

    return parseAiChatResponse(assistantText, sessionId);
  }

  const result = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: 'build',
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
