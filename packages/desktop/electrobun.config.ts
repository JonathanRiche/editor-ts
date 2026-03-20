import type { ElectrobunConfig } from "electrobun";
export default {
  app: {
    identifier: 'com.verde.desktop',
    name: 'Verde',
    version: '0.0.1',
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    linux: {
      bundleCEF: true,
      icon: 'assets/icon-bolt.png',
    },
    copy: {
      dist: 'views',
    },
  },
  runtime: {
    desktopRendererEntry: 'bundled',

  },
  scripts: {
    preBuild: 'scripts/prebuild-native.ts',
  },
} satisfies ElectrobunConfig;
