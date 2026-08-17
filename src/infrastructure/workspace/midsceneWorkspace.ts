import {
  EMPTY_WORKSPACE,
  type CreatedProject,
  type InspectedProject,
  type ProjectManifest,
  type WorkspaceMetadata,
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

export const MIDSCENE_PROJECT_ROOT = "C:\\Preshot Midscene Runs";
const WORKSPACE_KEY = "preshot.midscene.workspace";
const PROJECTS_KEY = "preshot.midscene.projects";

function readJson<T>(key: string, fallback: T): T {
  const value = window.localStorage.getItem(key);
  return value ? JSON.parse(value) as T : structuredClone(fallback);
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createRegistry(): WorkspaceRegistry {
  return {
    async load() {
      return readJson<WorkspaceMetadata>(WORKSPACE_KEY, EMPTY_WORKSPACE);
    },
    async save(metadata) {
      writeJson(WORKSPACE_KEY, metadata);
    },
  };
}

function createNative(): NativeWorkspace {
  const loadProjects = () => readJson<Record<string, ProjectManifest>>(PROJECTS_KEY, {});
  const saveProjects = (projects: Record<string, ProjectManifest>) => writeJson(PROJECTS_KEY, projects);
  const inspected = (path: string, manifest: ProjectManifest): InspectedProject => ({
    path,
    manifest: structuredClone(manifest),
    resolvedCoverImage: null,
    coverDataUrl: null,
  });

  return {
    async createProject(parentPath, name): Promise<CreatedProject> {
      const path = `${parentPath}\\${name}`;
      const projects = loadProjects();
      if (projects[path]) throw new Error(`Project already exists: ${path}`);
      const now = new Date().toISOString();
      const manifest: ProjectManifest = {
        schemaVersion: 1,
        id: `midscene-${crypto.randomUUID()}`,
        name,
        createdAt: now,
        updatedAt: now,
      };
      projects[path] = manifest;
      saveProjects(projects);
      return { project: inspected(path, manifest), rollbackToken: path };
    },
    async inspectProject(path) {
      const manifest = loadProjects()[path];
      if (!manifest) throw new Error(`Unknown Midscene project: ${path}`);
      return inspected(path, manifest);
    },
    async rollbackCreatedProject(path) {
      const projects = loadProjects();
      delete projects[path];
      saveProjects(projects);
    },
    async forgetCreatedProject() {
      return undefined;
    },
    async onMenuAction(_handler: (action: WorkspaceMenuAction) => void) {
      return () => undefined;
    },
  };
}

const directoryPicker: WorkspaceDirectoryPicker = {
  async pickDirectory() {
    return MIDSCENE_PROJECT_ROOT;
  },
};

export function createMidsceneWorkspaceDependencies(
  logger: WorkspaceLogger = workspaceLogger,
) {
  const native = createNative();
  return {
    service: createWorkspaceService({
      registry: createRegistry(),
      native,
      clock: { now: () => new Date().toISOString() },
      logger,
    }),
    directoryPicker,
    native: {
      onMenuAction(handler: (action: WorkspaceMenuAction) => void) {
        return native.onMenuAction(handler);
      },
      async maximizeWindow() {
        return undefined;
      },
    },
    projectDirectoryRevealer: {
      async revealProjectDirectory() {
        return undefined;
      },
    },
    logger,
  };
}

export function clearMidsceneWorkspaceStorage() {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("preshot.midscene.")) window.localStorage.removeItem(key);
  }
}
