export * from '@opencode-ai/sdk/client';
export type { ServerOptions } from './opencode-sdk-server-browser';

export const createOpencode = async (): Promise<never> => {
  throw new Error('createOpencode is unavailable in the browser-only Solid demos. Use aiProvider.mode = "client".');
};
