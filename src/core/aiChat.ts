import type { OpencodeClient, Part, Message } from '@opencode-ai/sdk';
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

    let assembled = '';

    const sleep = async (ms: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

    const readLatestAssistantMessage = async (): Promise<{
      id: string;
      text: string;
      completed: boolean;
    } | null> => {
      const messages = await client.session.messages({ path: { id: sessionId }, query: { limit: 20 } });
      const entries = Array.isArray(messages.data)
        ? (messages.data as Array<{ info: Message; parts: Part[] }>)
        : [];

      const assistants = entries
        .filter((entry) => entry.info.role === 'assistant' && entry.info.sessionID === sessionId)
        .sort((a, b) => {
          const left = typeof a.info.time?.created === 'number' ? a.info.time.created : 0;
          const right = typeof b.info.time?.created === 'number' ? b.info.time.created : 0;
          return right - left;
        });

      const latest = assistants[0];
      if (!latest) return null;

      const text = latest.parts
        .filter((part) => part.type === 'text')
        .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
        .join('');

      return {
        id: latest.info.id,
        text,
        completed: typeof (latest.info.time as { completed?: unknown } | undefined)?.completed === 'number',
      };
    };

    const waitForResult = async (): Promise<string> => {
      const timeoutMs = 90_000;
      const timeoutAt = Date.now() + timeoutMs;

      while (Date.now() <= timeoutAt) {
        const latest = await readLatestAssistantMessage();
        if (latest) {
          if (latest.text.length > assembled.length) {
            const next = latest.text.slice(assembled.length);
            assembled = latest.text;
            if (next.length > 0) {
              onStream(next);
            }
          }

          if (latest.completed && assembled.trim()) {
            return assembled;
          }
        }

        await sleep(1000);
      }

      if (assembled.trim()) {
        return assembled;
      }

      throw new Error('Streaming timed out waiting for assistant response.');
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
