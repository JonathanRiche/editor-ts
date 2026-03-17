export type AiModelRef = {
  providerID: string;
  modelID: string;
};

export const normalizeOpencodeModelId = (providerID: string, modelID: string): string => {
  if (providerID !== 'opencode') return modelID;
  if (modelID === 'claude-sonnet-4-5-20250929') return 'claude-sonnet-4-5';
  return modelID;
};

export const encodeAiModelSelectValue = ({ providerID, modelID }: AiModelRef): string => `${providerID}/${modelID}`;

export const parseAiModelRef = (value: string): AiModelRef | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const [providerID, ...rest] = trimmed.split('/');
  if (!providerID || rest.length === 0) return undefined;

  return {
    providerID,
    modelID: normalizeOpencodeModelId(providerID, rest.join('/')),
  };
};

export const formatAiModelOptionLabel = ({ providerID, modelID }: AiModelRef): string => {
  if (providerID === 'opencode') return `${modelID} (OpenCode Zen)`;
  if (providerID === 'openai') return `${modelID} (OpenAI auth)`;
  return `${modelID} (${providerID})`;
};

export const readProviderDefaultModels = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};

  const result: Record<string, string> = {};
  for (const [providerID, modelID] of Object.entries(value)) {
    if (typeof modelID === 'string' && modelID.trim()) {
      result[providerID] = normalizeOpencodeModelId(providerID, modelID);
    }
  }

  return result;
};
