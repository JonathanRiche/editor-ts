import { defineElectrobunRPC } from 'electrobun/bun';

import type { Database } from 'bun:sqlite';

import type { DesktopRpcSchema } from '../shared/desktopRpcSchema';
import { createDesktopService } from './server';

type DesktopRpcOptions = {
  db: Database;
  sqlitePath: string;
  userDataPath: string;
};

export const createDesktopRpc = (options: DesktopRpcOptions) => {
  const service = createDesktopService(options);

  return defineElectrobunRPC<DesktopRpcSchema>('bun', {
    handlers: {
      requests: {
        getDesktopState: () => service.getState(),
        setDesktopSetting: (params) => service.setSetting(params),
        openProjectDialog: (params) => service.openProject(params),
        touchRecentProject: (params) => service.touchRecentProject(params),
        listProjectFiles: (params) => service.listProjectFiles(params),
        readProjectFile: (params) => service.readProjectFile(params),
        writeProjectFile: (params) => service.writeProjectFile(params),
      },
      messages: {},
    },
  });
};
