import { describe, expect, it } from 'bun:test';
import {
  applyAiReplacementsToFiles,
  applyAiReplacementsToPage,
  buildAiChatSnapshot,
  buildAiChatSnapshotFromFiles,
  buildAiChatSystemPrompt,
  buildAiChatSystemPromptWithOptions,
  extractAiChatRequestText,
  extractAiReplacementPaths,
  normalizeOpencodeModelId,
  parseAiChatResponse,
  requestAiReplacements,
  summarizeAiAssistantText,
} from '../src/core/aiChat';
import { Page } from '../src/core/Page';
import type { EditorTsAiChatReplacement, PageData } from '../src/types';
import type { Message, OpencodeClient } from '@opencode-ai/sdk';

describe('aiChat helpers', () => {
  const basePage: PageData = {
    title: 'AI Page',
    item_id: 1,
    body: { components: [], assets: [], styles: [] },
  };

  it('parses replacements from fenced JSON', () => {
    const content = {
      replacements: [
        { path: 'page.json', content_b64: btoa('{"hello":"world"}') },
        { path: 'styles.css', content: 'body { color: red; }' },
      ],
    };

    const text = [
      'Here you go:',
      '',
      '```json',
      JSON.stringify(content),
      '```',
      '',
    ].join('\n');

    const parsed = parseAiChatResponse(text, 'session-1');

    expect(parsed.sessionId).toBe('session-1');
    expect(parsed.replacements).toHaveLength(2);
    expect(parsed.replacements[0]?.content).toContain('hello');
    expect(parsed.replacements[1]?.path).toBe('styles.css');
  });

  it('skips malformed base64 replacements but keeps valid ones', () => {
    const content = {
      replacements: [
        { path: 'page.json', content_b64: '==' },
        { path: 'styles.css', content: 'body { color: red; }' },
      ],
    };

    const parsed = parseAiChatResponse(JSON.stringify(content), 'session-2');

    expect(parsed.replacements).toEqual([{ path: 'styles.css', content: 'body { color: red; }' }]);
    expect(parsed.warnings).toContain('Skipped malformed base64 replacement for page.json.');
  });

  it('skips invalid page json replacements while keeping valid css', () => {
    const content = {
      replacements: [
        { path: 'page.json', content: '==' },
        { path: 'styles.css', content: 'body { color: blue; }' },
      ],
    };

    const parsed = parseAiChatResponse(JSON.stringify(content), 'session-3');

    expect(parsed.replacements).toEqual([{ path: 'styles.css', content: 'body { color: blue; }' }]);
    expect(parsed.warnings).toContain('Skipped invalid JSON replacement for page.json.');
  });

  it('builds system prompt and snapshot', () => {
    const prompt = buildAiChatSystemPrompt();
    const snapshot = buildAiChatSnapshot('{"title":"AI"}', 'body { }', { 'components/hero.js': 'console.log(1);' });

    expect(prompt).toContain('Return JSON only');
    expect(snapshot).toContain('page.json');
    expect(snapshot).toContain('components/hero.js');
  });

  it('supports adapter-aware prompt and snapshot helpers', () => {
    const prompt = buildAiChatSystemPromptWithOptions({
      allowedPaths: ['src/App.tsx', 'styles/site.css'],
    });

    const snapshot = buildAiChatSnapshotFromFiles(
      {
        'src/App.tsx': 'export const App = () => null;',
        'styles/site.css': 'body { margin: 0; }',
      },
      {
        derivedPaths: ['src/App.tsx'],
        readOnlyPaths: ['styles/site.css'],
      }
    );

    expect(prompt).toContain('Allowed paths: src/App.tsx, styles/site.css');
    expect(snapshot).toContain('src/App.tsx (derived)');
    expect(snapshot).toContain('styles/site.css (read-only)');
  });

  it('extracts the user-facing request text from the stored prompt envelope', () => {
    const requestText = extractAiChatRequestText([
      'You are an automated assistant integrated with EditorTs.',
      'FILES:',
      'styles.css:\nbody { color: blue; }',
      '',
      'REQUEST:',
      'Make the hero more polished.',
    ].join('\n'));

    expect(requestText).toBe('Make the hero more polished.');
  });

  it('extracts replacement paths from partial assistant payloads', () => {
    const partial = '{"replacements":[{"path":"styles.css","content_b64":"abc"},{"path":"src/App.tsx"';
    expect(extractAiReplacementPaths(partial)).toEqual(['styles.css', 'src/App.tsx']);
  });

  it('summarizes assistant replacement payloads for display', () => {
    const summary = summarizeAiAssistantText(JSON.stringify({
      replacements: [
        { path: 'styles.css', content: 'body { color: red; }' },
        { path: 'src/App.tsx', content: 'export const App = () => null;' },
      ],
    }));

    expect(summary).toContain('Prepared 2 file changes.');
    expect(summary).toContain('- styles.css');
    expect(summary).toContain('- src/App.tsx');
  });

  it('normalizes opencode model ids', () => {
    expect(normalizeOpencodeModelId('opencode', 'claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeOpencodeModelId('other', 'model-x')).toBe('model-x');
  });

  it('streams assistant output from SDK events without polling session messages', async () => {
    const sessionId = 'session-stream';
    const messageId = 'message-stream';
    const createdAt = Date.now();
    const rawText = JSON.stringify({
      replacements: [
        { path: 'styles.css', content: 'body { color: red; }' },
      ],
    });
    const deltas = ['{"replacements":[', '{"path":"styles.css","content":"body { color: red; }"}', ']}'];
    const streamed: string[] = [];
    let messageReads = 0;

    const assistantMessage = (completed?: number): Message => ({
      id: messageId,
      sessionID: sessionId,
      role: 'assistant',
      time: completed ? { created: createdAt, completed } : { created: createdAt },
      parentID: 'user-message-1',
      modelID: 'claude-sonnet-4-5',
      providerID: 'opencode',
      mode: 'build',
      path: {
        cwd: '/tmp/project',
        root: '/tmp/project',
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    });

    const client = {
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(),
              },
            };

            let currentText = '';
            for (const [index, delta] of deltas.entries()) {
              currentText += delta;
              yield {
                type: 'message.part.updated',
                properties: {
                  part: {
                    id: `part-${index + 1}`,
                    sessionID: sessionId,
                    messageID: messageId,
                    type: 'text',
                    text: currentText,
                  },
                  delta,
                },
              };
            }

            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(createdAt + 500),
              },
            };
          })(),
        }),
      },
      session: {
        promptAsync: async () => ({ error: undefined }),
        messages: async () => {
          messageReads += 1;
          return {
            data: [
              {
                info: assistantMessage(createdAt + 500),
                parts: [
                  {
                    id: 'part-3',
                    sessionID: sessionId,
                    messageID: messageId,
                    type: 'text',
                    text: rawText,
                  },
                ],
              },
            ],
          };
        },
      },
    } as unknown as OpencodeClient;

    const result = await requestAiReplacements({
      client,
      prompt: 'Make the CSS red.',
      workspaceFiles: {
        'styles.css': 'body { color: blue; }',
      },
      allowedPaths: ['styles.css'],
      sessionId,
      model: {
        providerID: 'opencode',
        modelID: 'claude-sonnet-4-5',
      },
      stream: true,
      onStream: (delta) => {
        streamed.push(delta);
      },
    });

    expect(streamed.join('')).toBe(rawText);
    expect(messageReads).toBeGreaterThanOrEqual(1);
    expect(result.replacements).toEqual([
      { path: 'styles.css', content: 'body { color: red; }' },
    ]);
  });

  it('switches to a newer assistant message when an earlier placeholder stays empty', async () => {
    const sessionId = 'session-stream-switch';
    const placeholderMessageId = 'message-placeholder';
    const finalMessageId = 'message-final';
    const createdAt = Date.now();
    const rawText = JSON.stringify({
      replacements: [
        { path: 'styles.css', content: 'body { color: orange; }' },
      ],
    });
    const deltas = ['{"replacements":[', '{"path":"styles.css","content":"body { color: orange; }"}', ']}'];
    const streamed: string[] = [];

    const assistantMessage = (messageId: string, completed?: number, created = createdAt): Message => ({
      id: messageId,
      sessionID: sessionId,
      role: 'assistant',
      time: completed ? { created, completed } : { created },
      parentID: 'user-message-1',
      modelID: 'claude-sonnet-4-5',
      providerID: 'opencode',
      mode: 'build',
      path: {
        cwd: '/tmp/project',
        root: '/tmp/project',
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    });

    const client = {
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(placeholderMessageId),
              },
            };

            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(placeholderMessageId, createdAt + 200),
              },
            };

            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(finalMessageId, undefined, createdAt + 300),
              },
            };

            let currentText = '';
            for (const [index, delta] of deltas.entries()) {
              currentText += delta;
              yield {
                type: 'message.part.updated',
                properties: {
                  part: {
                    id: `part-switch-${index + 1}`,
                    sessionID: sessionId,
                    messageID: finalMessageId,
                    type: 'text',
                    text: currentText,
                  },
                  delta,
                },
              };
            }

            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(finalMessageId, createdAt + 500, createdAt + 300),
              },
            };
          })(),
        }),
      },
      session: {
        promptAsync: async () => ({ error: undefined }),
        messages: async () => {
          return {
            data: [
              {
                info: assistantMessage(placeholderMessageId, createdAt + 200),
                parts: [],
              },
              {
                info: assistantMessage(finalMessageId, createdAt + 500, createdAt + 300),
                parts: [
                  {
                    id: 'part-switch-3',
                    sessionID: sessionId,
                    messageID: finalMessageId,
                    type: 'text',
                    text: rawText,
                  },
                ],
              },
            ],
          };
        },
      },
    } as unknown as OpencodeClient;

    const result = await requestAiReplacements({
      client,
      prompt: 'Make the CSS orange.',
      workspaceFiles: {
        'styles.css': 'body { color: blue; }',
      },
      allowedPaths: ['styles.css'],
      sessionId,
      model: {
        providerID: 'opencode',
        modelID: 'claude-sonnet-4-5',
      },
      stream: true,
      onStream: (delta) => {
        streamed.push(delta);
      },
    });

    expect(result.rawText).toBe(rawText);
    expect(result.replacements).toEqual([
      { path: 'styles.css', content: 'body { color: orange; }' },
    ]);
  });

  it('waits for a settled assistant payload after an early idle signal', async () => {
    const sessionId = 'session-stream-settle';
    const placeholderMessageId = 'message-settle-placeholder';
    const finalMessageId = 'message-settle-final';
    const createdAt = Date.now();
    const finalText = JSON.stringify({
      replacements: [
        { path: 'styles.css', content: 'body { color: teal; }' },
      ],
    });
    let messageReads = 0;

    const assistantMessage = (messageId: string, completed?: number, created = createdAt): Message => ({
      id: messageId,
      sessionID: sessionId,
      role: 'assistant',
      time: completed ? { created, completed } : { created },
      parentID: 'user-message-1',
      modelID: 'gpt-5.4',
      providerID: 'opencode',
      mode: 'build',
      path: {
        cwd: '/tmp/project',
        root: '/tmp/project',
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    });

    const client = {
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(placeholderMessageId),
              },
            };

            yield {
              type: 'message.updated',
              properties: {
                info: assistantMessage(placeholderMessageId, createdAt + 100),
              },
            };

            yield {
              type: 'session.idle',
              properties: {
                sessionID: sessionId,
              },
            };
          })(),
        }),
      },
      session: {
        promptAsync: async () => ({ error: undefined }),
        messages: async () => {
          messageReads += 1;

          if (messageReads < 3) {
            return {
              data: [
                {
                  info: assistantMessage(placeholderMessageId, createdAt + 100),
                  parts: [],
                },
              ],
            };
          }

          return {
            data: [
              {
                info: assistantMessage(placeholderMessageId, createdAt + 100),
                parts: [],
              },
              {
                info: assistantMessage(finalMessageId, createdAt + 400, createdAt + 250),
                parts: [
                  {
                    id: 'part-settle-1',
                    sessionID: sessionId,
                    messageID: finalMessageId,
                    type: 'text',
                    text: finalText,
                  },
                ],
              },
            ],
          };
        },
      },
    } as unknown as OpencodeClient;

    const result = await requestAiReplacements({
      client,
      prompt: 'Make the CSS teal.',
      workspaceFiles: {
        'styles.css': 'body { color: blue; }',
      },
      allowedPaths: ['styles.css'],
      sessionId,
      model: {
        providerID: 'opencode',
        modelID: 'gpt-5.4',
      },
      stream: true,
      onStream: () => {
        // no-op
      },
    });

    expect(messageReads).toBeGreaterThanOrEqual(3);
    expect(result.rawText).toBe(finalText);
    expect(result.replacements).toEqual([
      { path: 'styles.css', content: 'body { color: teal; }' },
    ]);
  });

  it('applies replacements to storage handlers', async () => {
    const page = new Page(basePage);
    const applied: EditorTsAiChatReplacement[] = [];

    await applyAiReplacementsToPage({
      page,
      replacements: [
        { path: 'page.json', content: '{"title":"Updated"}' },
        { path: 'styles.css', content: 'body { color: blue; }' },
        { path: 'components/hero.js', content: 'console.log("hero")' },
      ],
      saveJson: async (json) => {
        applied.push({ path: 'page.json', content: json });
      },
      saveCss: async (css) => {
        applied.push({ path: 'styles.css', content: css });
      },
      saveComponentScript: async (id, script) => {
        applied.push({ path: `components/${id}.js`, content: script });
      },
    });

    expect(applied.map((item) => item.path)).toEqual([
      'page.json',
      'styles.css',
      'components/hero.js',
    ]);
  });

  it('applies replacements through file saver with path guardrails', async () => {
    const writes: Array<{ path: string; content: string }> = [];

    const result = await applyAiReplacementsToFiles({
      replacements: [
        { path: 'styles.css', content: 'body { color: red; }' },
        { path: 'secret.env', content: 'SHOULD_NOT_WRITE=true' },
      ],
      isPathAllowed: (path) => path === 'styles.css',
      saveFile: async (path, content) => {
        writes.push({ path, content });
      },
    });

    expect(writes).toEqual([{ path: 'styles.css', content: 'body { color: red; }' }]);
    expect(result.appliedPaths).toEqual(['styles.css']);
    expect(result.skippedPaths).toEqual(['secret.env']);
  });
});
