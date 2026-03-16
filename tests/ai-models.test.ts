import { describe, expect, it } from 'bun:test';
import {
  encodeAiModelSelectValue,
  formatAiModelOptionLabel,
  normalizeOpencodeModelId,
  parseAiModelRef,
  readProviderDefaultModels,
} from '../src/core/aiModels';

describe('aiModels helpers', () => {
  it('normalizes dated opencode aliases', () => {
    expect(normalizeOpencodeModelId('opencode', 'claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeOpencodeModelId('openai', 'gpt-5.4')).toBe('gpt-5.4');
  });

  it('round-trips provider-aware selector values', () => {
    const value = encodeAiModelSelectValue({ providerID: 'openai', modelID: 'gpt-5.4' });
    expect(value).toBe('openai/gpt-5.4');
    expect(parseAiModelRef(value)).toEqual({ providerID: 'openai', modelID: 'gpt-5.4' });
  });

  it('formats option labels with provider callouts', () => {
    expect(formatAiModelOptionLabel({ providerID: 'opencode', modelID: 'gpt-5.4' })).toBe('gpt-5.4 (OpenCode Zen)');
    expect(formatAiModelOptionLabel({ providerID: 'openai', modelID: 'gpt-5.4' })).toBe('gpt-5.4 (OpenAI auth)');
  });

  it('reads provider defaults from dynamic config data', () => {
    expect(readProviderDefaultModels({
      opencode: 'claude-sonnet-4-5-20250929',
      openai: 'gpt-5.4',
      invalid: 42,
    })).toEqual({
      opencode: 'claude-sonnet-4-5',
      openai: 'gpt-5.4',
    });
  });
});
