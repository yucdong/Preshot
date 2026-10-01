import { readWorkspaceMetadata } from "../../domain/workspace/metadata";
import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_WORKSPACE,
  type WorkspaceMetadata,
} from "../../domain/workspace/models";
import type { WorkspaceRegistry } from "../../domain/workspace/ports";

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

const cloneMetadata = readWorkspaceMetadata;
const validateWorkspaceMetadata = readWorkspaceMetadata;

async function defaultLoadStore(): Promise<StoreLike> {
  let pending: unknown;
  return {
    get: async () => (await invoke("read_workspace_registry")) ?? undefined,
    set: (_key, value) => { pending = value; },
    save: async () => { await invoke("write_workspace_registry", { value: pending }); },
  };
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
