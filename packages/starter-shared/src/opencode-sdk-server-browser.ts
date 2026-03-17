import type { OpencodeClientConfig } from '@opencode-ai/sdk/client';

export type ServerOptions = {
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  timeout?: number;
  config?: OpencodeClientConfig;
};

export const createOpencodeServer = async (): Promise<never> => {
  throw new Error('createOpencodeServer is unavailable in the browser-only starter apps.');
};

export const createOpencodeTui = (): never => {
  throw new Error('createOpencodeTui is unavailable in the browser-only starter apps.');
};
