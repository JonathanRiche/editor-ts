import type { DesktopKeyboardConfig } from './shared/keyboard';

export {};

declare global {
  interface Window {
    __EDITORTS_DESKTOP__?: {
      runtime: 'electrobun';
      sqlitePath: string;
      userDataPath: string;
      rendererUrl: string;
      uiScale?: number;
      debugAi?: boolean;
      bundledRenderer?: boolean;
      initialProjectRoot?: string;
      keyboard: DesktopKeyboardConfig;
      nativeShortcutsAvailable?: boolean;
    };
  }
}
