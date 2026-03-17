export default {
  app: {
    identifier: 'com.editorts.desktop',
    name: 'EditorTs Desktop',
    version: '0.0.0',
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    copy: {
      dist: 'views',
    },
  },
  runtime: {
    desktopRendererEntry: 'views://index.html',
  },
  scripts: {
    preBuild: 'scripts/prebuild-native.ts',
  },
};
