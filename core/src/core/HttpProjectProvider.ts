import type {
  ProjectFilesystemFileEntry,
  ProjectFilesystemProvider,
} from './ProjectFilesystemAdapter';

export type HttpProjectProviderHeaders = Record<string, string>;

type HeaderFactory =
  | HttpProjectProviderHeaders
  | (() => HttpProjectProviderHeaders | Promise<HttpProjectProviderHeaders>);

export interface HttpProjectProviderConfig {
  /** Base URL for the remote files API (for example: https://api.example.com/project). */
  baseUrl: string;

  /** Optional static or async headers (for example: Authorization). */
  headers?: HeaderFactory;

  /** Optional fetch credentials mode. */
  credentials?: RequestCredentials;

  /** Optional query params appended to every request. */
  query?: Record<string, string>;

  /**
   * Custom fetch implementation.
   * Defaults to the global `fetch`.
   */
  fetch?: typeof fetch;

  /**
   * Endpoint overrides.
   *
   * Defaults:
   * - listFiles: GET /files
   * - readFile: GET /files/:path
   * - writeFile: PUT /files/:path
   */
  endpoints?: {
    listFiles?: string;
    readFile?: string;
    writeFile?: string;
  };
}

type ListFilesResponse = {
  files?: unknown;
};

type ReadFileResponse = {
  content?: unknown;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const encodePathSegments = (value: string): string => {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

const resolveHeaders = async (headers?: HeaderFactory): Promise<HttpProjectProviderHeaders> => {
  if (!headers) return {};
  if (typeof headers === 'function') {
    return headers();
  }
  return headers;
};

const normalizeFileEntry = (entry: unknown): string | ProjectFilesystemFileEntry | null => {
  if (typeof entry === 'string') {
    return entry;
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const rawPath = (entry as { path?: unknown }).path;
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return null;
  }

  const readOnly = (entry as { readOnly?: unknown }).readOnly;
  const language = (entry as { language?: unknown }).language;

  return {
    path: rawPath,
    readOnly: typeof readOnly === 'boolean' ? readOnly : undefined,
    language: typeof language === 'string' ? language : undefined,
  };
};

export const createHttpProjectProvider = (config: HttpProjectProviderConfig): ProjectFilesystemProvider => {
  const request = config.fetch ?? fetch;
  const baseUrl = trimTrailingSlash(config.baseUrl.trim());
  const listEndpoint = config.endpoints?.listFiles ?? '/files';
  const readEndpoint = config.endpoints?.readFile ?? '/files/:path';
  const writeEndpoint = config.endpoints?.writeFile ?? '/files/:path';

  const buildUrl = (endpoint: string, path?: string): string => {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const encodedPath = typeof path === 'string' ? encodePathSegments(path) : null;

    let nextPath = normalizedEndpoint;
    if (encodedPath !== null) {
      if (nextPath.includes(':path')) {
        nextPath = nextPath.replace(':path', encodedPath);
      }
    }

    const url = new URL(`${baseUrl}${nextPath}`);

    Object.entries(config.query ?? {}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    if (encodedPath !== null && !normalizedEndpoint.includes(':path')) {
      url.searchParams.set('path', path ?? '');
    }

    return url.toString();
  };

  const send = async (input: {
    endpoint: string;
    method: 'GET' | 'PUT';
    path?: string;
    body?: string;
  }): Promise<Response> => {
    const headers = await resolveHeaders(config.headers);
    const response = await request(buildUrl(input.endpoint, input.path), {
      method: input.method,
      credentials: config.credentials,
      headers: input.body
        ? {
            'Content-Type': 'application/json',
            ...headers,
          }
        : headers,
      body: input.body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Remote project request failed: ${response.status}`);
    }

    return response;
  };

  return {
    listFiles: async () => {
      const response = await send({ endpoint: listEndpoint, method: 'GET' });
      const payload = (await response.json()) as unknown;

      const rawFiles = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as ListFilesResponse).files)
          ? ((payload as ListFilesResponse).files ?? []) as unknown[]
          : [];

      return rawFiles
        .map((entry: unknown) => normalizeFileEntry(entry))
        .filter((entry: string | ProjectFilesystemFileEntry | null): entry is string | ProjectFilesystemFileEntry => entry !== null);
    },

    readFile: async (path: string) => {
      const response = await send({ endpoint: readEndpoint, method: 'GET', path });

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as unknown;
        if (payload === null) return null;
        if (typeof payload === 'string') return payload;
        return typeof (payload as ReadFileResponse).content === 'string'
          ? (payload as ReadFileResponse).content as string
          : null;
      }

      const text = await response.text();
      return text;
    },

    writeFile: async (path: string, content: string) => {
      await send({
        endpoint: writeEndpoint,
        method: 'PUT',
        path,
        body: JSON.stringify({ content }),
      });
    },
  };
};
