import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import sqlocal from 'sqlocal/vite';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

import { handleRemoteProjectRequest } from './src/remoteProject';

const readBody = async (req: IncomingMessage): Promise<Uint8Array | undefined> => {
  if ((req.method ?? 'GET').toUpperCase() === 'GET') return undefined;

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
};

const sendResponse = async (response: Response, res: ServerResponse): Promise<void> => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
};

const remoteProjectRoutes = (): Plugin => {
  return {
    name: 'editorts-remote-project-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          try {
            if (!req.url) {
              next();
              return;
            }

            const body = await readBody(req);
            const request = new Request(new URL(req.url, 'http://127.0.0.1').toString(), {
              method: req.method,
              headers: new Headers(req.headers as Record<string, string>),
              body: body ? Buffer.from(body) : undefined,
            });

            const response = await handleRemoteProjectRequest(request);
            if (!response) {
              next();
              return;
            }

            await sendResponse(response, res);
          } catch (error) {
            next(error as Error);
          }
        })();
      });
    },
  };
};

export default defineConfig({
  plugins: [
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    solid({ ssr: true }),
    sqlocal(),
    remoteProjectRoutes(),
  ],
  server: {
    port: 2022,
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: [
      {
        find: /^@opencode-ai\/sdk$/,
        replacement: fileURLToPath(new URL('../starter-shared/src/opencode-sdk-browser.ts', import.meta.url)),
      },
      {
        find: /^@opencode-ai\/sdk\/server$/,
        replacement: fileURLToPath(new URL('../starter-shared/src/opencode-sdk-server-browser.ts', import.meta.url)),
      },
    ],
  },
});
