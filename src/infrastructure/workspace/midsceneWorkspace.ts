import {
  EMPTY_WORKSPACE,
  type CreatedProject,
  type InspectedProject,
  type ProjectManifest,
  type WorkspaceMetadata,
} from "../../domain/workspace/models";
import { createWorkspaceService } from "../../domain/workspace/service";
import {
  createStarterProjectPlan,
  STARTER_PROJECT_NAME,
} from "../../domain/workspace/starterProject";
import type {
  NativeWorkspace,
  WorkspaceDirectoryPicker,
  WorkspaceLogger,
  WorkspaceMenuAction,
  WorkspaceRegistry,
} from "../../domain/workspace/ports";
import { workspaceLogger } from "../../shared/logging/logger";

export const MIDSCENE_PROJECT_ROOT = "C:\\Preshot Midscene Runs";
export const MIDSCENE_USER_ROOT = "C:\\Preshot Midscene";
export const MIDSCENE_STARTER_PATH =
  `${MIDSCENE_PROJECT_ROOT}\\Preshot 入门示例`;
const WORKSPACE_KEY = "preshot.midscene.workspace";
const PROJECTS_KEY = "preshot.midscene.projects";
const STARTER_PLAN_KEY =
  `preshot.browser-blocknote-plan-v14:${encodeURIComponent(MIDSCENE_STARTER_PATH)}`;
const STARTER_ID = "midscene-starter-project";
const STARTER_TIME = "2026-08-19T15:04:03.669Z";

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

function createDeterministicClock() {
  let tick = 0;
  return {
    now() {
      const value = new Date(Date.UTC(2026, 7, 19, 15, 4, 4, tick)).toISOString();
      tick += 1;
      return value;
    },
  };
}

function createNative(clock: { now(): string }): NativeWorkspace {
  const loadProjects = () => readJson<Record<string, ProjectManifest>>(PROJECTS_KEY, {});
  const saveProjects = (projects: Record<string, ProjectManifest>) => writeJson(PROJECTS_KEY, projects);
  const inspected = (path: string, manifest: ProjectManifest): InspectedProject => ({
    path,
    manifest: structuredClone(manifest),
    resolvedCoverImage: null,
    coverDataUrl: null,
  });

  return {
    async ensureUserDataRoots() {
      return {
        userRoot: MIDSCENE_USER_ROOT,
        projectsRoot: MIDSCENE_PROJECT_ROOT,
      };
    },
    async bootstrapUserData(registeredProjects) {
      const roots = await this.ensureUserDataRoots();
      const projects = loadProjects();
      const registeredAvailable = registeredProjects.some(
        ({ projectId, path }) => projects[path]?.id === projectId,
      );
      if (registeredAvailable) {
        return { roots, project: null, rollbackToken: null };
      }
      const [existingPath] = Object.keys(projects).sort();
      if (existingPath) {
        return {
          roots,
          project: inspected(existingPath, projects[existingPath]),
          rollbackToken: null,
        };
      }
      const manifest: ProjectManifest = {
        schemaVersion: 1,
        id: STARTER_ID,
        name: STARTER_PROJECT_NAME,
        createdAt: STARTER_TIME,
        updatedAt: STARTER_TIME,
      };
      projects[MIDSCENE_STARTER_PATH] = manifest;
      saveProjects(projects);
      window.sessionStorage.setItem(
        STARTER_PLAN_KEY,
        JSON.stringify(createStarterProjectPlan()),
      );
      return {
        roots,
        project: inspected(MIDSCENE_STARTER_PATH, manifest),
        rollbackToken: MIDSCENE_STARTER_PATH,
      };
    },
    async createProject(parentPath, name): Promise<CreatedProject> {
      const path = `${parentPath}\\${name}`;
      const projects = loadProjects();
      if (projects[path]) throw new Error(`Project already exists: ${path}`);
      const now = clock.now();
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
      if (path === MIDSCENE_STARTER_PATH) {
        window.sessionStorage.removeItem(STARTER_PLAN_KEY);
      }
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
  const clock = createDeterministicClock();
  const native = createNative(clock);
  return {
    service: createWorkspaceService({
      registry: createRegistry(),
      native,
      clock,
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
      async revealProjectDirectory(_path: string) {
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
  window.sessionStorage.removeItem(STARTER_PLAN_KEY);
}
