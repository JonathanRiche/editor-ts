export {};

declare global {
  interface Window {
    __EDITORTS_DESKTOP__?: {
      runtime: 'electrobun';
      sqlitePath: string;
      userDataPath: string;
      rendererUrl: string;
      uiScale?: number;
      bundledRenderer?: boolean;
    };
  }
}
