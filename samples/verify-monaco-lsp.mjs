import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const waitForHttpOk = async (url, timeoutMs = 30_000) => {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }
};

const run = async () => {
  const port = process.env.PORT ?? '5021';
  const url = `http://localhost:${port}/`;

  let server = null;
  let startedServer = false;

  try {
    try {
      await waitForHttpOk(url, 1500);
    } catch {
      server = spawn('bun', ['run', 'local-server.ts'], {
        stdio: 'inherit',
        env: { ...process.env, PORT: port },
      });
      startedServer = true;
    }

    await waitForHttpOk(url);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Switch to Code view
    await page.click('#tab-code');

    page.on('console', (msg) => {
      // Surface console errors from the app while testing.
      if (msg.type() === 'error') {
        console.error('[browser]', msg.text());
      }
    });

    page.on('pageerror', (err) => {
      console.error('[pageerror]', err);
    });

    const assertSuggest = async ({ tabButton, container, typeText, expectText }) => {
      await page.click(tabButton);

      const editor = page.locator(`${container} .monaco-editor`);
      await editor.waitFor({ state: 'visible', timeout: 30_000 });

      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(typeText);
      await page.keyboard.press('Control+Space');

      const suggest = page.locator(`${container} .monaco-editor .suggest-widget`).first();
      await suggest.waitFor({ state: 'visible', timeout: 60_000 });

      const started = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const suggestText = await suggest.innerText();

        if (!/loading/i.test(suggestText) && new RegExp(expectText, 'i').test(suggestText)) {
          return;
        }

        if (Date.now() - started > 90_000) {
          throw new Error(`Expected suggestions to include ${expectText}, got:\n${suggestText}`);
        }

        await page.waitForTimeout(250);
      }
    };

    await assertSuggest({
      tabButton: '#code-tab-js',
      container: '#js-editor-container',
      typeText: 'con',
      expectText: 'console',
    });

    await assertSuggest({
      tabButton: '#code-tab-css',
      container: '#css-editor-container',
      // Put the cursor inside a declaration so CSS LSP suggests properties.
      typeText: 'body { dis',
      expectText: 'display',
    });

    // JSON language service: ensure the suggest widget isn't stuck on Loading.
    await assertSuggest({
      tabButton: '#code-tab-json',
      container: '#json-editor-container',
      typeText: '{"',
      expectText: 'New object',
    });

    // Let the app settle before closing.
    await page.waitForTimeout(250);

    await browser.close();
    console.log('OK: Monaco language services are active (JS/CSS/JSON).');
  } finally {
    if (server && startedServer) {
      server.kill('SIGTERM');
    }
  }

  // Ensure dev server is not left running.
  if (startedServer) {
    try {
      await waitForHttpOk(url, 1500);
    } catch {
      // already down
      return;
    }
    throw new Error('Dev server still responding after test cleanup.');
  }
};

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
