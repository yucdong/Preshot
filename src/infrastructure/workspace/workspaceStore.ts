import { load } from "@tauri-apps/plugin-store";
import {
  EMPTY_WORKSPACE,
  type WorkspaceMetadata,
  type WorkspaceProjectRecord,
} from "../../domain/workspace/models";
import type { WorkspaceRegistry } from "../../domain/workspace/ports";

const STORE_FILE = "workspace.json";
const STORE_KEY = "workspace";

type StoreLike = {
  get(key: string): Promise<unknown> | unknown;
  set(key: string, value: unknown): Promise<void> | void;
  save(): Promise<void> | void;
};

interface Dependencies {
  loadStore?: () => Promise<StoreLike>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isProjectAvailability(value: unknown): value is "available" | "unavailable" {
  return value === "available" || value === "unavailable";
}

function detail(error: unknown): string {
  if (isObjectRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}

function contextualError(context: string, error: unknown): Error {
  return new Error(`${context}: ${detail(error)}`, {
    cause: error,
  });
}

function cloneProject(project: WorkspaceProjectRecord): WorkspaceProjectRecord {
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
    projects: metadata.projects.map((project) => cloneProject(project)),
  };
}

function validateProjectRecord(value: unknown): WorkspaceProjectRecord {
  if (!isObjectRecord(value)) {
    throw new Error("Workspace metadata is malformed");
  }

  if (hasOwn(value, "coverDataUrl")) {
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

  if (value.schemaVersion !== 1) {
    if (typeof value.schemaVersion === "number") {
      throw new Error(`Unsupported workspace schema ${value.schemaVersion}`);
    }

    throw new Error("Workspace metadata is malformed");
  }

  if (!Array.isArray(value.projects)) {
    throw new Error("Workspace metadata is malformed");
  }

  return {
    schemaVersion: 1,
    projects: value.projects.map((project) => validateProjectRecord(project)),
  };
}

async function defaultLoadStore(): Promise<StoreLike> {
  return load(STORE_FILE, { autoSave: false });
}

export function createWorkspaceStore({
  loadStore = defaultLoadStore,
}: Dependencies = {}): WorkspaceRegistry {
  let storePromise: Promise<StoreLike> | null = null;

  function getStore(): Promise<StoreLike> {
    if (storePromise === null) {
      storePromise = loadStore().catch((error) => {
        storePromise = null;
        throw error;
      });
    }

    return storePromise;
  }

  return {
    async load(): Promise<WorkspaceMetadata> {
      try {
        const store = await getStore();
        const value = await store.get(STORE_KEY);

        if (value === undefined) {
          return cloneMetadata(EMPTY_WORKSPACE);
        }

        return cloneMetadata(validateWorkspaceMetadata(value));
      } catch (error) {
        throw contextualError("Unable to load workspace metadata", error);
      }
    },

    async save(metadata: WorkspaceMetadata): Promise<void> {
      try {
        const validated = validateWorkspaceMetadata(metadata);
        const store = await getStore();

        await store.set(STORE_KEY, cloneMetadata(validated));
        await store.save();
      } catch (error) {
        throw contextualError("Unable to save workspace metadata", error);
      }
    },
  };
}

export const workspaceRegistry = createWorkspaceStore();
