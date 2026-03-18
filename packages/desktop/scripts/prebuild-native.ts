import { $ } from 'bun';

if (process.env.EDITORTS_ELECTROBUN_SKIP_PREBUILD === '1') {
  process.exit(0);
}

await $`bun x vite build --mode bundled`;
