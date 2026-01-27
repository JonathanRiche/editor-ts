import solid from 'vite-plugin-solid';
import sqlocal from 'sqlocal/vite';

import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [

    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    solid(
      { ssr: true }
    ),
    sqlocal()],
});

