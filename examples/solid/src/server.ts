import { Hono } from 'hono';
import { generateHydrationScript, renderToString } from 'solid-js/web';

import App from './App';
import { handleRemoteProjectRequest, type RemoteProjectEnv } from './remoteProject';

const app = new Hono<{ Bindings: RemoteProjectEnv }>();

const injectAppHtml = (template: string, appHtml: string): string => {
  if (template.includes('<!--ssr-outlet-->')) {
    return template.replace('<!--ssr-outlet-->', appHtml);
  }

  return template.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`);
};

const injectHydrationScript = (template: string): string => {
  if (template.includes('data-editorts-solid-hydration')) {
    return template;
  }

  return template.replace(
    '</head>',
    `${generateHydrationScript().replace('<script', '<script data-editorts-solid-hydration')}\n  </head>`
  );
};

const loadTemplate = async (requestUrl: string): Promise<string> => {
  if (import.meta.env.DEV) {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EditorTs Solid Hosted Demo</title>
    ${generateHydrationScript().replace('<script', '<script data-editorts-solid-hydration')}
    <script type="module" src="/src/client.tsx"></script>
  </head>
  <body>
    <div id="app"><!--ssr-outlet--></div>
  </body>
</html>`;
  }

  const response = await fetch(new URL('/index.html', requestUrl));
  if (!response.ok) {
    throw new Error(`Failed to load built client template: ${response.status} ${response.statusText}`);
  }

  return response.text();
};

app.all('/api/project/files', async (c) => {
  const response = await handleRemoteProjectRequest(c.req.raw, c.env);
  return response ?? new Response('Not found', { status: 404 });
});

app.all('/api/project/files/*', async (c) => {
  const response = await handleRemoteProjectRequest(c.req.raw, c.env);
  return response ?? new Response('Not found', { status: 404 });
});

app.get('/', async (c) => {
  const html = renderToString(() => App());
  const template = injectHydrationScript(await loadTemplate(c.req.url));

  return new Response(
    injectAppHtml(template, html),
    {
      headers: {
        'Content-Type': 'text/html',
      },
    },
  );
});

export default app;
