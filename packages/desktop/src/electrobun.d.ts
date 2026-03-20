import type { DesktopKeyboardConfig } from './shared/keyboard';
import type { DesktopPerfConfig } from './shared/desktopRpcSchema';

export {};

declare global {
  interface Window {
    __electrobunSendToHost?: (message: unknown) => void;
    __EDITORTS_CANVAS_POST_MESSAGE__?: (message: unknown) => void;
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
      perf?: DesktopPerfConfig;
    };
  }

  interface ElectrobunWebviewElement extends HTMLElement {
    webviewId?: number | null;
    src?: string;
    html?: string;
    preload?: string;
    hidden?: boolean;
    executeJavascript(js: string): void;
    syncDimensions(force?: boolean): void;
    toggleHidden(value?: boolean): void;
    on(event: string, listener: (event: CustomEvent<unknown>) => void): void;
    off(event: string, listener: (event: CustomEvent<unknown>) => void): void;
  }

  interface HTMLElementTagNameMap {
    'electrobun-webview': ElectrobunWebviewElement;
  }

  namespace JSX {
    interface IntrinsicElements {
      'electrobun-webview': {
        id?: string;
        class?: string;
        src?: string;
        html?: string;
        preload?: string;
        'data-editorts-canvas'?: string;
      };
    }
  }
}
