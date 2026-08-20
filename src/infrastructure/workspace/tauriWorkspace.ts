import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  CreatedProject,
  InspectedProject,
  ProjectManifest,
  RegisteredProjectIdentity,
  UserDataBootstrapResult,
  UserDataRoots,
} from "../../domain/workspace/models";
import type {
  NativeWorkspace,
  WorkspaceLogger,
  WorkspaceMenuAction,
} from "../../domain/workspace/ports";
import { workspaceLogger } from "../../shared/logging/logger";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type ListenForEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

interface Dependencies {
  invokeCommand?: InvokeCommand;
  listenForEvent?: ListenForEvent;
  logger?: WorkspaceLogger;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function detail(error: unknown): string {
  if (isObjectRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (isObjectRecord(error) && typeof error.code === "string") {
    return error.code;
  }

  return undefined;
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key];

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("Malformed native response");
  }

  return candidate;
}

function readOptionalManifestCoverImage(
  value: Record<string, unknown>,
): string | undefined {
  if (!hasOwn(value, "coverImage")) {
    return undefined;
  }

  const candidate = value.coverImage;

  if (typeof candidate !== "string") {
    throw new Error("Malformed native response");
  }

  return candidate;
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];

  if (candidate === null) {
    return null;
  }

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("Malformed native response");
  }

  return candidate;
}

function validateProjectManifest(value: unknown): ProjectManifest {
  if (!isObjectRecord(value)) {
    throw new Error("Malformed native response");
  }

  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== 1) {
    throw new Error("Malformed native response");
  }

  const coverImage = readOptionalManifestCoverImage(value);

  return {
    schemaVersion: 1,
    id: readRequiredString(value, "id"),
    name: readRequiredString(value, "name"),
    createdAt: readRequiredString(value, "createdAt"),
    updatedAt: readRequiredString(value, "updatedAt"),
    ...(coverImage === undefined ? {} : { coverImage }),
  };
}

function validateInspectedProject(value: unknown): InspectedProject {
  if (!isObjectRecord(value)) {
    throw new Error("Malformed native response");
  }

  return {
    path: readRequiredString(value, "path"),
    manifest: validateProjectManifest(value.manifest),
    resolvedCoverImage: readNullableString(value, "resolvedCoverImage"),
    coverDataUrl: readNullableString(value, "coverDataUrl"),
  };
}

function validateCreatedProject(value: unknown): CreatedProject {
  if (!isObjectRecord(value)) {
    throw new Error("Malformed native response");
  }

  return {
    project: validateInspectedProject(value.project),
    rollbackToken: readRequiredString(value, "rollbackToken"),
  };
}

function validateUserDataRoots(value: unknown): UserDataRoots {
  if (!isObjectRecord(value)) {
    throw new Error("Malformed native response");
  }
  return {
    userRoot: readRequiredString(value, "userRoot"),
    projectsRoot: readRequiredString(value, "projectsRoot"),
  };
}

function validateBootstrapResult(value: unknown): UserDataBootstrapResult {
  if (!isObjectRecord(value)) {
    throw new Error("Malformed native response");
  }
  const project = value.project;
  const rollbackToken = value.rollbackToken;
  if (
    !(project === null || isObjectRecord(project)) ||
    !(rollbackToken === null || (
      typeof rollbackToken === "string" && rollbackToken.length > 0
    ))
  ) {
    throw new Error("Malformed native response");
  }
  if (project === null && rollbackToken !== null) {
    throw new Error("Malformed native response");
  }
  return {
    roots: validateUserDataRoots(value.roots),
    project: project === null ? null : validateInspectedProject(project),
    rollbackToken,
  };
}

function isWorkspaceMenuAction(value: unknown): value is WorkspaceMenuAction {
  return value === "new-project" || value === "open-project";
}

export class WorkspaceNativeError extends Error {
  readonly code?: string;

  constructor(message: string, options: { cause: unknown; code?: string }) {
    super(message, { cause: options.cause });
    this.name = "WorkspaceNativeError";
    this.code = options.code;
  }
}

function wrapNativeError(context: string, error: unknown): WorkspaceNativeError {
  return new WorkspaceNativeError(`${context}: ${detail(error)}`, {
    cause: error,
    code: errorCode(error),
  });
}

async function defaultListenForEvent(
  event: string,
  handler: (event: { payload: unknown }) => void,
): Promise<() => void> {
  return listen<WorkspaceMenuAction>(event, (tauriEvent) => {
    handler({ payload: tauriEvent.payload });
  });
}

export function createTauriWorkspace({
  invokeCommand = invoke,
  listenForEvent = defaultListenForEvent,
  logger = workspaceLogger,
}: Dependencies = {}): NativeWorkspace {
  return {
    async ensureUserDataRoots(): Promise<UserDataRoots> {
      try {
        return validateUserDataRoots(
          await invokeCommand("ensure_user_data_roots"),
        );
      } catch (error) {
        throw wrapNativeError("Unable to ensure Preshot user data folders", error);
      }
    },

    async bootstrapUserData(
      registeredProjects: RegisteredProjectIdentity[],
    ): Promise<UserDataBootstrapResult> {
      try {
        return validateBootstrapResult(
          await invokeCommand("bootstrap_user_data", { registeredProjects }),
        );
      } catch (error) {
        throw wrapNativeError("Unable to bootstrap Preshot user data", error);
      }
    },

    async createProject(parentPath: string, name: string): Promise<CreatedProject> {
      try {
        const result = await invokeCommand("create_project", {
          parentPath,
          name,
        });
        return validateCreatedProject(result);
      } catch (error) {
        throw wrapNativeError("Unable to create Preshot project", error);
      }
    },

    async inspectProject(path: string): Promise<InspectedProject> {
      try {
        const result = await invokeCommand("inspect_project", { path });
        return validateInspectedProject(result);
      } catch (error) {
        throw wrapNativeError("Unable to inspect Preshot project", error);
      }
    },

    async rollbackCreatedProject(rollbackToken: string): Promise<void> {
      try {
        await invokeCommand("rollback_created_project", { rollbackToken });
      } catch (error) {
        throw wrapNativeError(
          "Unable to roll back created Preshot project",
          error,
        );
      }
    },

    async forgetCreatedProject(rollbackToken: string): Promise<void> {
      try {
        await invokeCommand("forget_created_project", { rollbackToken });
      } catch (error) {
        throw wrapNativeError(
          "Unable to forget created Preshot project rollback token",
          error,
        );
      }
    },

    async onMenuAction(
      handler: (action: WorkspaceMenuAction) => void,
    ): Promise<() => void> {
      try {
        return await listenForEvent("workspace://menu", (event) => {
          if (!isWorkspaceMenuAction(event.payload)) {
            logger.warn("Ignoring unknown workspace menu action", {
              payload: event.payload,
            });
            return;
          }

          handler(event.payload);
        });
      } catch (error) {
        throw wrapNativeError("Unable to listen for workspace menu actions", error);
      }
    },
  };
}

export const tauriWorkspace = createTauriWorkspace();
