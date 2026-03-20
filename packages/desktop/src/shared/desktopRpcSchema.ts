export type DesktopSettingKey =
  | 'aiBaseUrl'
  | 'aiDirectory'
  | 'previewBaseUrl'
  | 'lastProjectRoot';

export type DesktopRecentProject = {
  path: string;
  label?: string;
  openedAt?: number;
};

export type DesktopNativeSettings = {
  aiBaseUrl?: string | null;
  aiDirectory?: string | null;
  previewBaseUrl?: string | null;
  lastProjectRoot?: string | null;
};

export type DesktopNativeState = {
  sqlitePath: string;
  userDataPath: string;
  recentProjects: DesktopRecentProject[];
  settings: DesktopNativeSettings;
};

export type DesktopStoredPage = {
  value: string | null;
};

export type DesktopOpenProjectResult = {
  path: string | null;
  label?: string;
};

export type DesktopCanvasFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopRendererLogMessage = {
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  stack?: string;
};

export type DesktopZoomAction = 'in' | 'out' | 'reset';

export type DesktopPerfScalar = boolean | number | string | null;

export type DesktopPerfFields = Record<string, DesktopPerfScalar>;

export type DesktopPerfEvent = {
  sessionId?: string;
  origin: 'main' | 'renderer';
  kind: 'frame-stall' | 'lifecycle' | 'longtask' | 'mark' | 'measure' | 'rpc' | 'sample';
  name: string;
  at: number;
  monotonicMs?: number;
  fields?: DesktopPerfFields;
};

export type DesktopPerfConfig = {
  enabled: boolean;
  sessionId?: string;
  outputPath?: string;
  sampleIntervalMs?: number;
  frameStallThresholdMs?: number;
  longTaskThresholdMs?: number;
};

export type DesktopRpcSchema = {
  bun: {
    requests: {
      getDesktopState: {
        params: undefined;
        response: DesktopNativeState;
      };
      setDesktopSetting: {
        params: {
          key: DesktopSettingKey;
          value: string;
        };
        response: {
          ok: true;
        };
      };
      openProjectDialog: {
        params: {
          startingFolder?: string;
        } | undefined;
        response: DesktopOpenProjectResult;
      };
      touchRecentProject: {
        params: {
          path: string;
          label?: string;
        };
        response: {
          ok: true;
          path: string;
          label: string;
        };
      };
      listProjectFiles: {
        params: {
          root: string;
        };
        response: {
          files: string[];
        };
      };
      readProjectFile: {
        params: {
          root: string;
          path: string;
        };
        response: {
          content: string | null;
        };
      };
      writeProjectFile: {
        params: {
          root: string;
          path: string;
          content: string;
        };
        response: {
          ok: true;
        };
      };
      loadDesktopStoragePage: {
        params: {
          key: string;
        };
        response: DesktopStoredPage;
      };
      saveDesktopStoragePage: {
        params: {
          key: string;
          value: string;
        };
        response: {
          ok: true;
        };
      };
      deleteDesktopStoragePage: {
        params: {
          key: string;
        };
        response: {
          ok: true;
        };
      };
      toggleDesktopDevTools: {
        params: undefined;
        response: {
          ok: true;
        };
      };
      adjustDesktopZoom: {
        params: {
          action: DesktopZoomAction;
        };
        response: {
          ok: true;
        };
      };
      syncDesktopCanvasWebview: {
        params: {
          id: number;
          hidden: boolean;
          frame: DesktopCanvasFrame;
        };
        response: {
          ok: true;
        };
      };
    };
    messages: {
      rendererLog: DesktopRendererLogMessage;
      perfEvent: DesktopPerfEvent;
    };
  };
  webview: {
    requests: Record<never, never>;
    messages: Record<never, never>;
  };
};
