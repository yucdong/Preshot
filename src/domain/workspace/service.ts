import type {
  WorkspaceMetadata,
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "./models";
import type {
  NativeWorkspace,
  WorkspaceClock,
  WorkspaceLogger,
  WorkspaceRegistry,
  WorkspaceService,
} from "./ports";
import {
  inspectedToProject,
  markProjectUnavailable,
  relocateProject as assertRelocation,
  sortProjects,
  upsertProject,
} from "./registry";

interface Dependencies {
  registry: WorkspaceRegistry;
  native: NativeWorkspace;
  clock: WorkspaceClock;
  logger: WorkspaceLogger;
}

const contextualErrorMarker = Symbol("workspaceServiceContextualError");

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextualError(context: string, error: unknown): Error {
  const wrappedError = new Error(`${context}: ${message(error)}`, {
    cause: error,
  });

  Object.defineProperty(wrappedError, contextualErrorMarker, {
    value: true,
  });

  return wrappedError;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectAvailability(value: unknown): value is "available" | "unavailable" {
  return value === "available" || value === "unavailable";
}

function validateProjectRecord(value: unknown): WorkspaceProjectRecord {
  if (!isObjectRecord(value)) {
    throw new Error("Workspace metadata is malformed");
  }

  if ("coverDataUrl" in value) {
    throw new Error("Workspace metadata is malformed");
  }

  if (
    typeof value.projectId !== "string" ||
    typeof value.path !== "string" ||
    typeof value.name !== "string" ||
    !(typeof value.coverImage === "string" || value.coverImage === null) ||
    !isProjectAvailability(value.status) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.lastOpenedAt !== "string"
  ) {
    throw new Error("Workspace metadata is malformed");
  }

  return {
    projectId: value.projectId,
    path: value.path,
    name: value.name,
    coverImage: value.coverImage,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastOpenedAt: value.lastOpenedAt,
  };
}

function validateWorkspaceMetadata(value: unknown): WorkspaceMetadata {
  if (!isObjectRecord(value)) {
    throw new Error("Workspace metadata is malformed");
  }

  if (typeof value.schemaVersion !== "number") {
    throw new Error("Workspace metadata is malformed");
  }

  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported workspace schema ${value.schemaVersion}`);
  }

  if (!Array.isArray(value.projects)) {
    throw new Error("Workspace metadata is malformed");
  }

  return {
    schemaVersion: 1,
    projects: value.projects.map((project) => validateProjectRecord(project)),
  };
}

function toPersistedRecord(project: WorkspaceProjectView): WorkspaceProjectRecord {
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

function cloneProjectRecord(project: WorkspaceProjectRecord): WorkspaceProjectRecord {
  return {
    ...project,
  };
}

function cloneProjectView(project: WorkspaceProjectView): WorkspaceProjectView {
  return {
    ...project,
  };
}

function cloneMetadata(metadata: WorkspaceMetadata): WorkspaceMetadata {
  return {
    schemaVersion: 1,
    projects: metadata.projects.map((project) => cloneProjectRecord(project)),
  };
}

function cloneProjects(projects: WorkspaceProjectView[]): WorkspaceProjectView[] {
  return projects.map((project) => cloneProjectView(project));
}

export function createWorkspaceService({
  registry,
  native,
  clock,
  logger,
}: Dependencies): WorkspaceService {
  let metadataCache: WorkspaceMetadata | null = null;
  let projectCache: WorkspaceProjectView[] | null = null;
  let operationQueue: Promise<void> = Promise.resolve();

  function queueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = operationQueue.then(operation, operation);
    operationQueue = queuedOperation.then(
      () => undefined,
      () => undefined,
    );

    return queuedOperation;
  }

  async function readMetadataInternal(): Promise<WorkspaceMetadata> {
    if (metadataCache !== null) {
      return cloneMetadata(metadataCache);
    }

    try {
      const loaded: unknown = await registry.load();
      const validated = validateWorkspaceMetadata(loaded);

      metadataCache = cloneMetadata(validated);
      return cloneMetadata(metadataCache);
    } catch (error) {
      throw contextualError("Unable to load workspace metadata", error);
    }
  }

  async function persistProjectsInternal(
    projects: WorkspaceProjectView[],
  ): Promise<void> {
    const ownedProjects = cloneProjects(projects);
    const nextMetadata: WorkspaceMetadata = {
      schemaVersion: 1,
      projects: ownedProjects.map((project) => toPersistedRecord(project)),
    };

    try {
      await registry.save(cloneMetadata(nextMetadata));
      metadataCache = cloneMetadata(nextMetadata);
      projectCache = cloneProjects(ownedProjects);
    } catch (error) {
      throw contextualError("Unable to save workspace metadata", error);
    }
  }

  async function ensureLoadedProjectsInternal(): Promise<WorkspaceProjectView[]> {
    if (projectCache !== null) {
      return cloneProjects(projectCache);
    }

    const metadata = await readMetadataInternal();

    if (metadata.projects.length === 0) {
      projectCache = [];
      return [];
    }

    return loadProjectsInternal();
  }

  async function loadProjectsInternal(): Promise<WorkspaceProjectView[]> {
    const metadata = await readMetadataInternal();
    const validatedProjects = await Promise.all(
      metadata.projects.map(async (project) => {
        try {
          const inspected = await native.inspectProject(project.path);

          if (inspected.manifest.id !== project.projectId) {
            const reason = `Registered path belongs to a different project ID (${inspected.manifest.id})`;
            logger.warn("Workspace project unavailable", {
              projectId: project.projectId,
              reason,
            });

            return markProjectUnavailable(project);
          }

          return inspectedToProject(inspected, project.lastOpenedAt);
        } catch (error) {
          logger.warn("Workspace project unavailable", {
            projectId: project.projectId,
            reason: message(error),
          });

          return markProjectUnavailable(project);
        }
      }),
    );
    const sortedProjects = sortProjects(validatedProjects);

    await persistProjectsInternal(sortedProjects);
    return cloneProjects(sortedProjects);
  }

  async function createProjectInternal(
    parentPath: string,
    name: string,
  ): Promise<WorkspaceProjectView> {
    const currentProjects = await ensureLoadedProjectsInternal();

    let createdProject: WorkspaceProjectView;
    let rollbackToken: string;

    try {
      const created = await native.createProject(parentPath, name);
      createdProject = inspectedToProject(created.project, clock.now());
      rollbackToken = created.rollbackToken;
    } catch (error) {
      throw contextualError("Unable to create workspace project", error);
    }

    try {
      await persistProjectsInternal(
        upsertProject(cloneProjects(currentProjects), cloneProjectView(createdProject)),
      );
    } catch (saveError) {
      try {
        await native.rollbackCreatedProject(rollbackToken);
      } catch (rollbackError) {
        logger.error("Workspace project rollback failed", {
          projectId: createdProject.projectId,
          reason: message(rollbackError),
        });

        throw new Error(
          `${message(saveError)}; rollback failed: ${message(rollbackError)}`,
          {
            cause: saveError,
          },
        );
      }

      throw saveError;
    }

    try {
      await native.forgetCreatedProject(rollbackToken);
    } catch (forgetError) {
      logger.error("Workspace project rollback token forget failed", {
        projectId: createdProject.projectId,
        reason: message(forgetError),
      });
    }

    logger.info("Workspace project created", {
      projectId: createdProject.projectId,
    });
    return cloneProjectView(createdProject);
  }

  async function openProjectInternal(path: string): Promise<WorkspaceProjectView> {
    const currentProjects = await ensureLoadedProjectsInternal();

    let openedProject: WorkspaceProjectView;

    try {
      const inspected = await native.inspectProject(path);
      openedProject = inspectedToProject(inspected, clock.now());
    } catch (error) {
      throw contextualError("Unable to open workspace project", error);
    }

    await persistProjectsInternal(
      upsertProject(cloneProjects(currentProjects), cloneProjectView(openedProject)),
    );
    logger.info("Workspace project opened", {
      projectId: openedProject.projectId,
    });
    return cloneProjectView(openedProject);
  }

  async function relocateProjectInternal(
    currentProject: WorkspaceProjectRecord,
    path: string,
  ): Promise<WorkspaceProjectView> {
    let relocatedProject: WorkspaceProjectView;

    try {
      const inspected = await native.inspectProject(path);
      relocatedProject = assertRelocation(
        currentProject,
        inspectedToProject(inspected, clock.now()),
      );
    } catch (error) {
      throw contextualError("Unable to relocate workspace project", error);
    }

    const currentProjects = await ensureLoadedProjectsInternal();
    await persistProjectsInternal(
      upsertProject(cloneProjects(currentProjects), cloneProjectView(relocatedProject)),
    );
    logger.info("Workspace project relocated", {
      projectId: relocatedProject.projectId,
    });
    return cloneProjectView(relocatedProject);
  }

  async function removeRecordInternal(
    projectId: string,
  ): Promise<WorkspaceProjectView[]> {
    const currentProjects = await ensureLoadedProjectsInternal();
    const nextProjects = sortProjects(
      cloneProjects(currentProjects).filter(
        (project) => project.projectId !== projectId,
      ),
    );

    await persistProjectsInternal(nextProjects);
    logger.info("Workspace project removed", { projectId });
    return cloneProjects(nextProjects);
  }

  async function loadProjects(): Promise<WorkspaceProjectView[]> {
    return queueOperation(() => loadProjectsInternal());
  }

  async function createProject(
    parentPath: string,
    name: string,
  ): Promise<WorkspaceProjectView> {
    return queueOperation(() => createProjectInternal(parentPath, name));
  }

  async function openProject(path: string): Promise<WorkspaceProjectView> {
    return queueOperation(() => openProjectInternal(path));
  }

  async function relocateProject(
    currentProject: WorkspaceProjectRecord,
    path: string,
  ): Promise<WorkspaceProjectView> {
    return queueOperation(() => relocateProjectInternal(currentProject, path));
  }

  async function removeRecord(projectId: string): Promise<WorkspaceProjectView[]> {
    return queueOperation(() => removeRecordInternal(projectId));
  }

  return {
    loadProjects,
    createProject,
    openProject,
    relocateProject,
    removeRecord,
  };
}
