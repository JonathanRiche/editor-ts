type StubError = Error & { code?: string };

const unsupported = (api: string): never => {
  const err = new Error(`${api} is unavailable in this browser-only demo.`) as StubError;
  err.code = 'OPENCODE_STUB_UNSUPPORTED';
  throw err;
};

export const createOpencodeClient = (): never => unsupported('createOpencodeClient');
export const createOpencode = async (): Promise<never> => unsupported('createOpencode');
