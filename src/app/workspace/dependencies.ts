import { createWorkspaceService } from "../../domain/workspace/service";
import type {
  NativeWorkspace,
  ProjectDirectoryRevealer,
  WorkspaceDirectoryPicker,
  WorkspaceLogger,
  WorkspaceService,
} from "../../domain/workspace/ports";
import {
  browserWorkspaceDependencies,
} from "../../infrastructure/workspace/browserWorkspace";
import { createMidsceneWorkspaceDependencies } from "../../infrastructure/workspace/midsceneWorkspace";
import { tauriWorkspace } from "../../infrastructure/workspace/tauriWorkspace";
import { workspaceDirectoryPicker } from "../../infrastructure/workspace/workspaceDialog";
import { workspaceRegistry } from "../../infrastructure/workspace/workspaceStore";
import { workspaceLogger } from "../../shared/logging/logger";
import { projectDirectoryRevealer } from "../../infrastructure/workspace/projectDirectoryRevealer";

export interface WorkspaceDependencies {
  service: WorkspaceService;
  directoryPicker: WorkspaceDirectoryPicker;
  native: Pick<NativeWorkspace, "onMenuAction">;
  projectDirectoryRevealer: ProjectDirectoryRevealer;
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
    projectDirectoryRevealer,
    logger,
  };
}

export function createWorkspaceDependencies(): WorkspaceDependencies {
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The Midscene workspace adapter is only available in test mode and must never run in a production build.",
      );
    }
    return createMidsceneWorkspaceDependencies();
  }
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "memory") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The in-memory workspace adapter is only available in end-to-end mode and must never run in a production build.",
      );
    }

    return browserWorkspaceDependencies;
  }

  return createProductionWorkspaceDependencies();
}
