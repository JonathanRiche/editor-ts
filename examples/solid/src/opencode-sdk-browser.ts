export * from '@opencode-ai/sdk/client';
export type { ServerOptions } from '@opencode-ai/sdk/server';

export const createOpencode = async (): Promise<never> => {
  throw new Error('createOpencode is unavailable in the browser-only Solid demo. Use aiProvider.mode = "client".');
};
