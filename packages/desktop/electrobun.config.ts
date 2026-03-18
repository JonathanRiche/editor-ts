import type { ElectrobunConfig } from "electrobun";
export default {
  app: {
    identifier: 'com.blink.desktop',
    name: 'Blink',
    version: '0.0.1',
  },
  build: {

    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    linux: {
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
