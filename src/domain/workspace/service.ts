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

export function createWorkspaceService({
  registry,
  native,
  clock,
  logger,
}: Dependencies): WorkspaceService {
  let metadataCache: WorkspaceMetadata | null = null;
  let projectCache: WorkspaceProjectView[] | null = null;

  async function readMetadata(): Promise<WorkspaceMetadata> {
    if (metadataCache !== null) {
      return metadataCache;
    }

    try {
      const loaded: unknown = await registry.load();
      const validated = validateWorkspaceMetadata(loaded);

      metadataCache = validated;
      return validated;
    } catch (error) {
      throw contextualError("Unable to load workspace metadata", error);
    }
  }

  async function persistProjects(projects: WorkspaceProjectView[]): Promise<void> {
    const nextMetadata: WorkspaceMetadata = {
      schemaVersion: 1,
      projects: projects.map((project) => toPersistedRecord(project)),
    };

    try {
      await registry.save(nextMetadata);
      metadataCache = nextMetadata;
      projectCache = projects;
    } catch (error) {
      throw contextualError("Unable to save workspace metadata", error);
    }
  }

  async function ensureLoadedProjects(): Promise<WorkspaceProjectView[]> {
    if (projectCache !== null) {
      return projectCache;
    }

    const metadata = await readMetadata();

    if (metadata.projects.length === 0) {
      projectCache = [];
      return projectCache;
    }

    return loadProjects();
  }

  async function loadProjects(): Promise<WorkspaceProjectView[]> {
    const metadata = await readMetadata();
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

    await persistProjects(sortedProjects);
    return sortedProjects;
  }

  async function createProject(
    parentPath: string,
    name: string,
  ): Promise<WorkspaceProjectView> {
    const currentProjects = await ensureLoadedProjects();

    let createdProject: WorkspaceProjectView;

    try {
      const inspected = await native.createProject(parentPath, name);
      createdProject = inspectedToProject(inspected, clock.now());
    } catch (error) {
      throw contextualError("Unable to create workspace project", error);
    }

    try {
      await persistProjects(upsertProject(currentProjects, createdProject));
    } catch (saveError) {
      try {
        await native.removeCreatedProject(
          createdProject.path,
          createdProject.projectId,
        );
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

    logger.info("Workspace project created", {
      projectId: createdProject.projectId,
    });
    return createdProject;
  }

  async function openProject(path: string): Promise<WorkspaceProjectView> {
    const currentProjects = await ensureLoadedProjects();

    let openedProject: WorkspaceProjectView;

    try {
      const inspected = await native.inspectProject(path);
      openedProject = inspectedToProject(inspected, clock.now());
    } catch (error) {
      throw contextualError("Unable to open workspace project", error);
    }

    await persistProjects(upsertProject(currentProjects, openedProject));
    logger.info("Workspace project opened", {
      projectId: openedProject.projectId,
    });
    return openedProject;
  }

  async function relocateProject(
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

    const currentProjects = await ensureLoadedProjects();
    await persistProjects(upsertProject(currentProjects, relocatedProject));
    logger.info("Workspace project relocated", {
      projectId: relocatedProject.projectId,
    });
    return relocatedProject;
  }

  async function removeRecord(projectId: string): Promise<WorkspaceProjectView[]> {
    const currentProjects = await ensureLoadedProjects();
    const nextProjects = sortProjects(
      currentProjects.filter((project) => project.projectId !== projectId),
    );

    await persistProjects(nextProjects);
    logger.info("Workspace project removed", { projectId });
    return nextProjects;
  }

  return {
    loadProjects,
    createProject,
    openProject,
    relocateProject,
    removeRecord,
  };
}
