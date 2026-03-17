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

export type DesktopOpenProjectResult = {
  path: string | null;
  label?: string;
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
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: Record<never, never>;
    messages: Record<never, never>;
  };
};
