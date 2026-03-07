import solid from 'vite-plugin-solid';
import sqlocal from 'sqlocal/vite';
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [

    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    solid(
      { ssr: true }
    ),
    sqlocal()],
  resolve: {
    alias: [
      {
        find: /^@opencode-ai\/sdk$/,
        replacement: fileURLToPath(new URL('./src/opencode-sdk-browser.ts', import.meta.url)),
      },
    ],
  },
});
