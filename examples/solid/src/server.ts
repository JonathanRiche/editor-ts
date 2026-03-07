import { Hono } from 'hono';
import { generateHydrationScript, renderToString } from 'solid-js/web';

import App from './App';
import { handleRemoteProjectRequest, type RemoteProjectEnv } from './remoteProject';

const app = new Hono<{ Bindings: RemoteProjectEnv }>();

app.all('/api/project/files', async (c) => {
  const response = await handleRemoteProjectRequest(c.req.raw, c.env);
  return response ?? new Response('Not found', { status: 404 });
});

app.all('/api/project/files/*', async (c) => {
  const response = await handleRemoteProjectRequest(c.req.raw, c.env);
  return response ?? new Response('Not found', { status: 404 });
});

app.get('/', () => {
  const html = renderToString(() => App());

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EditorTs Solid Hosted Demo</title>
    ${generateHydrationScript()}
    <script type="module" src="/src/client.tsx"></script>
  </head>
  <body>
    <div id="app">${html}</div>
  </body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html',
      },
    },
  );
});

export default app;
