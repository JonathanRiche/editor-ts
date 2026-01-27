import { Hono } from 'hono';
import { generateHydrationScript, renderToString } from 'solid-js/web';

import App from './App';
const app = new Hono();

app.get('/', () => {
  const html = renderToString(() => App());

  console.log('App', App);
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EditorTs Solid + SQLocal</title>
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
// app.listen(3000);

// console.log(`Solid SSR demo running at http://${app.server?.hostname}:${app.server?.port}`);/

