import { createWorkspaceService } from "../../domain/workspace/service";
import type {
  NativeWorkspace,
  WorkspaceDirectoryPicker,
  WorkspaceLogger,
  WorkspaceService,
} from "../../domain/workspace/ports";
import {
  browserWorkspaceDependencies,
} from "../../infrastructure/workspace/browserWorkspace";
import { tauriWorkspace } from "../../infrastructure/workspace/tauriWorkspace";
import { workspaceDirectoryPicker } from "../../infrastructure/workspace/workspaceDialog";
import { workspaceRegistry } from "../../infrastructure/workspace/workspaceStore";
import { workspaceLogger } from "../../shared/logging/logger";

export interface WorkspaceDependencies {
  service: WorkspaceService;
  directoryPicker: WorkspaceDirectoryPicker;
  native: Pick<NativeWorkspace, "onMenuAction">;
  logger: WorkspaceLogger;
}

function createProductionWorkspaceDependencies(): WorkspaceDependencies {
  const logger = workspaceLogger;
  const native = tauriWorkspace;

  return {
    service: createWorkspaceService({
      registry: workspaceRegistry,
      native,
      clock: {
        now: () => new Date().toISOString(),
      },
      logger,
    }),
    directoryPicker: workspaceDirectoryPicker,
    native,
    logger,
  };
}

export function createWorkspaceDependencies(): WorkspaceDependencies {
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "memory") {
    return browserWorkspaceDependencies;
  }

  return createProductionWorkspaceDependencies();
}
