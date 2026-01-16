import { describe, expect, it } from 'bun:test';
import { applyAiReplacementsToPage, buildAiChatSnapshot, buildAiChatSystemPrompt, normalizeOpencodeModelId, parseAiChatResponse } from '../src/core/aiChat';
import { Page } from '../src/core/Page';
import type { EditorTsAiChatReplacement, PageData } from '../src/types';

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

  it('builds system prompt and snapshot', () => {
    const prompt = buildAiChatSystemPrompt();
    const snapshot = buildAiChatSnapshot('{"title":"AI"}', 'body { }', { 'components/hero.js': 'console.log(1);' });

    expect(prompt).toContain('Return JSON only');
    expect(snapshot).toContain('page.json');
    expect(snapshot).toContain('components/hero.js');
  });

  it('normalizes opencode model ids', () => {
    expect(normalizeOpencodeModelId('opencode', 'claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeOpencodeModelId('other', 'model-x')).toBe('model-x');
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
});
