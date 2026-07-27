import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceMetadata,
  WorkspaceProjectRecord,
} from "../../domain/workspace/models";
import { EMPTY_WORKSPACE } from "../../domain/workspace/models";
import { createWorkspaceStore } from "./workspaceStore";

type GetFromStore = (key: string) => Promise<unknown>;
type SetInStore = (key: string, value: unknown) => Promise<void>;
type SaveStoreFile = () => Promise<void>;
type MockStore = {
  get: ReturnType<typeof vi.fn<GetFromStore>>;
  set: ReturnType<typeof vi.fn<SetInStore>>;
  save: ReturnType<typeof vi.fn<SaveStoreFile>>;
};

type LoadStore = () => Promise<MockStore>;

const persistedRecord = (
  overrides: Partial<WorkspaceProjectRecord> = {},
): WorkspaceProjectRecord => ({
  projectId: "project-1",
  path: "C:\\shoots\\project-1",
  name: "Project 1",
  coverImage: "cover.png",
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  lastOpenedAt: "2026-07-03T00:00:00.000Z",
  ...overrides,
});

function expectErrorWithCause(
  error: unknown,
  message: string,
  cause: unknown,
): void {
  expect(error).toBeInstanceOf(Error);

  if (!(error instanceof Error)) {
    throw error;
  }

  expect(error.message).toBe(message);
  expect(error.cause).toBe(cause);
}

describe("createWorkspaceStore", () => {
  let store: MockStore;
  let loadStore: ReturnType<typeof vi.fn<LoadStore>>;

  beforeEach(() => {
    store = {
      get: vi.fn<GetFromStore>(),
      set: vi.fn<SetInStore>().mockResolvedValue(undefined),
      save: vi.fn<SaveStoreFile>().mockResolvedValue(undefined),
    };

    loadStore = vi.fn<LoadStore>().mockResolvedValue(store);
  });

  it("returns a fresh empty workspace when the workspace key is missing", async () => {
    store.get.mockResolvedValue(undefined);
    const registry = createWorkspaceStore({ loadStore });

    await expect(registry.load()).resolves.toEqual(EMPTY_WORKSPACE);
    expect(store.get).toHaveBeenCalledWith("workspace");
  });

  it("loads versioned workspace metadata when the persisted schema is valid", async () => {
    const metadata = {
      schemaVersion: 1,
      projects: [persistedRecord()],
    } satisfies WorkspaceMetadata;
    store.get.mockResolvedValue(metadata);
    const registry = createWorkspaceStore({ loadStore });

    await expect(registry.load()).resolves.toEqual(metadata);
  });

  it("rejects persisted metadata with an unsupported schema version", async () => {
    store.get.mockResolvedValue({
      schemaVersion: 2,
      projects: [],
    });
    const registry = createWorkspaceStore({ loadStore });

    await expect(registry.load()).rejects.toThrow(
      "Unable to load workspace metadata: Unsupported workspace schema 2",
    );
  });

  it("rejects persisted metadata with malformed project records", async () => {
    store.get.mockResolvedValue({
      schemaVersion: 1,
      projects: [{ ...persistedRecord(), path: 123 }],
    });
    const registry = createWorkspaceStore({ loadStore });

    await expect(registry.load()).rejects.toThrow(
      "Unable to load workspace metadata: Workspace metadata is malformed",
    );
  });

  it("rejects persisted metadata that contains runtime-only coverDataUrl values", async () => {
    store.get.mockResolvedValue({
      schemaVersion: 1,
      projects: [
        {
          ...persistedRecord(),
          coverDataUrl: "data:image/png;base64,preview",
        },
      ],
    });
    const registry = createWorkspaceStore({ loadStore });

    await expect(registry.load()).rejects.toThrow(
      "Unable to load workspace metadata: Workspace metadata is malformed",
    );
  });

  it("saves validated workspace metadata under the workspace key and flushes the store", async () => {
    const metadata = {
      schemaVersion: 1,
      projects: [persistedRecord()],
    } satisfies WorkspaceMetadata;
    const registry = createWorkspaceStore({ loadStore });

    await registry.save(metadata);

    expect(store.set).toHaveBeenCalledWith("workspace", metadata);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.set.mock.invocationCallOrder[0]).toBeLessThan(
      store.save.mock.invocationCallOrder[0],
    );
  });

  it("wraps store loader failures with load context and cause", async () => {
    const failure = new Error("plugin offline");
    loadStore.mockRejectedValue(failure);
    const registry = createWorkspaceStore({ loadStore });

    try {
      await registry.load();
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to load workspace metadata: plugin offline",
        failure,
      );
      return;
    }

    throw new Error("Expected load() to reject");
  });

  it("surfaces structured store loader failure messages", async () => {
    const failure = {
      message: "plugin offline",
    };
    loadStore.mockRejectedValue(failure);
    const registry = createWorkspaceStore({ loadStore });

    try {
      await registry.load();
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to load workspace metadata: plugin offline",
        failure,
      );
      return;
    }

    throw new Error("Expected load() to reject");
  });

  it("wraps store read failures with load context and cause", async () => {
    const failure = new Error("read failed");
    store.get.mockRejectedValue(failure);
    const registry = createWorkspaceStore({ loadStore });

    try {
      await registry.load();
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to load workspace metadata: read failed",
        failure,
      );
      return;
    }

    throw new Error("Expected load() to reject");
  });

  it("wraps malformed save payloads with save context", async () => {
    const registry = createWorkspaceStore({ loadStore });
    const saveUnchecked = registry.save as unknown as (
      metadata: unknown,
    ) => Promise<void>;

    await expect(
      saveUnchecked({
        schemaVersion: 1,
        projects: [
          {
            ...persistedRecord(),
            coverDataUrl: "data:image/png;base64,preview",
          },
        ],
      }),
    ).rejects.toThrow(
      "Unable to save workspace metadata: Workspace metadata is malformed",
    );
  });

  it("wraps store set failures with save context and cause", async () => {
    const failure = new Error("write denied");
    store.set.mockRejectedValue(failure);
    const registry = createWorkspaceStore({ loadStore });

    try {
      await registry.save({
        schemaVersion: 1,
        projects: [persistedRecord()],
      });
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to save workspace metadata: write denied",
        failure,
      );
      return;
    }

    throw new Error("Expected save() to reject");
  });

  it("wraps store flush failures with save context and cause", async () => {
    const failure = new Error("flush failed");
    store.save.mockRejectedValue(failure);
    const registry = createWorkspaceStore({ loadStore });

    try {
      await registry.save({
        schemaVersion: 1,
        projects: [persistedRecord()],
      });
    } catch (error) {
      expectErrorWithCause(
        error,
        "Unable to save workspace metadata: flush failed",
        failure,
      );
      return;
    }

    throw new Error("Expected save() to reject");
  });
});
