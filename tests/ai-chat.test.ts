import { describe, expect, it } from 'bun:test';
import {
  applyAiReplacementsToFiles,
  applyAiReplacementsToPage,
  buildAiChatSnapshot,
  buildAiChatSnapshotFromFiles,
  buildAiChatSystemPrompt,
  buildAiChatSystemPromptWithOptions,
  normalizeOpencodeModelId,
  parseAiChatResponse,
  requestAiReplacements,
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
    expect(messageReads).toBe(1);
    expect(result.replacements).toEqual([
      { path: 'styles.css', content: 'body { color: red; }' },
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
