import {
  EMPTY_WORKSPACE,
  type CreatedProject,
  type InspectedProject,
  type WorkspaceMetadata,
  type WorkspaceProjectRecord,
} from "../../domain/workspace/models";
import { createWorkspaceService } from "../../domain/workspace/service";
import type {
  NativeWorkspace,
  WorkspaceDirectoryPicker,
  WorkspaceLogger,
  WorkspaceMenuAction,
  WorkspaceRegistry,
} from "../../domain/workspace/ports";
import { workspaceLogger } from "../../shared/logging/logger";

export const EDITORIAL_DEMO_PATH = "C:\\Preshot Demo\\编辑大片示例";

const DEMO_PROJECT_RECORD: WorkspaceProjectRecord = {
  projectId: "editorial-demo",
  path: EDITORIAL_DEMO_PATH,
  name: "编辑大片示例",
  coverImage: null,
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  lastOpenedAt: "2026-07-03T00:00:00.000Z",
};

const DEMO_INSPECTED_PROJECT: InspectedProject = {
  path: EDITORIAL_DEMO_PATH,
  manifest: {
    schemaVersion: 1,
    id: DEMO_PROJECT_RECORD.projectId,
    name: DEMO_PROJECT_RECORD.name,
    createdAt: DEMO_PROJECT_RECORD.createdAt,
    updatedAt: DEMO_PROJECT_RECORD.updatedAt,
  },
  resolvedCoverImage: null,
  coverDataUrl: null,
};

function cloneProjectRecord(
  project: WorkspaceProjectRecord,
): WorkspaceProjectRecord {
  return {
    projectId: project.projectId,
    path: project.path,
    name: project.name,
    coverImage: project.coverImage,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
  };
}

function cloneMetadata(metadata: WorkspaceMetadata): WorkspaceMetadata {
  return {
    schemaVersion: 1,
    projects: metadata.projects.map((project) => cloneProjectRecord(project)),
  };
}

function cloneInspectedProject(project: InspectedProject): InspectedProject {
  return {
    path: project.path,
    manifest: {
      schemaVersion: 1,
      id: project.manifest.id,
      name: project.manifest.name,
      createdAt: project.manifest.createdAt,
      updatedAt: project.manifest.updatedAt,
      ...(project.manifest.coverImage === undefined
        ? {}
        : { coverImage: project.manifest.coverImage }),
    },
    resolvedCoverImage: project.resolvedCoverImage,
    coverDataUrl: project.coverDataUrl,
  };
}

function createBrowserWorkspaceRegistry(): WorkspaceRegistry {
  let metadata = cloneMetadata({
    ...EMPTY_WORKSPACE,
    projects: [DEMO_PROJECT_RECORD],
  });

  return {
    async load(): Promise<WorkspaceMetadata> {
      return cloneMetadata(metadata);
    },

    async save(nextMetadata: WorkspaceMetadata): Promise<void> {
      metadata = cloneMetadata(nextMetadata);
    },
  };
}

function createUnsupportedProject(): Promise<CreatedProject> {
  return Promise.reject(
    new Error("Browser workspace adapter does not support creating projects"),
  );
}

function createBrowserNativeWorkspace(): NativeWorkspace {
  return {
    async ensureUserDataRoots() {
      return {
        userRoot: "C:\\Preshot Browser",
        projectsRoot: "C:\\Preshot Browser\\projects",
      };
    },

    async bootstrapUserData() {
      return {
        roots: await this.ensureUserDataRoots(),
        project: null,
        rollbackToken: null,
      };
    },

    createProject() {
      return createUnsupportedProject();
    },

    async inspectProject(path: string): Promise<InspectedProject> {
      if (path !== EDITORIAL_DEMO_PATH) {
        throw new Error(`Unknown browser workspace project: ${path}`);
      }

      return cloneInspectedProject(DEMO_INSPECTED_PROJECT);
    },

    async rollbackCreatedProject(): Promise<void> {
      return undefined;
    },

    async forgetCreatedProject(): Promise<void> {
      return undefined;
    },

    async onMenuAction(): Promise<() => void> {
      return () => undefined;
    },
  };
}

const browserDirectoryPicker: WorkspaceDirectoryPicker = {
  async pickDirectory(): Promise<string | null> {
    return null;
  },
};

function createDeterministicClock() {
  let tick = 0;

  return {
    now(): string {
      const timestamp = new Date(
        Date.UTC(2026, 6, 27, 0, 0, tick, 0),
      ).toISOString();
      tick += 1;
      return timestamp;
    },
  };
}

function createNoopLogger(baseLogger: WorkspaceLogger): WorkspaceLogger {
  return {
    debug(message, data) {
      baseLogger.debug(message, data);
    },
    info(message, data) {
      baseLogger.info(message, data);
    },
    warn(message, data) {
      baseLogger.warn(message, data);
    },
    error(message, data) {
      baseLogger.error(message, data);
    },
  };
}

export function createBrowserWorkspaceDependencies(
  logger: WorkspaceLogger = workspaceLogger,
) {
  const browserLogger = createNoopLogger(logger);
  const native = createBrowserNativeWorkspace();

  return {
    service: createWorkspaceService({
      registry: createBrowserWorkspaceRegistry(),
      native,
      clock: createDeterministicClock(),
      logger: browserLogger,
    }),
    directoryPicker: browserDirectoryPicker,
    native: {
      onMenuAction(
        handler: (action: WorkspaceMenuAction) => void,
      ): Promise<() => void> {
        void handler;
        return native.onMenuAction(() => undefined);
      },
      async maximizeWindow(): Promise<void> {
        return undefined;
      },
    },
    projectDirectoryRevealer: {
      async revealProjectDirectory(_path: string): Promise<void> {
        return undefined;
      },
    },
    logger: browserLogger,
  };
}

export const browserWorkspaceDependencies =
  createBrowserWorkspaceDependencies();
