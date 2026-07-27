import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceService } from "./service";
import type {
  InspectedProject,
  WorkspaceMetadata,
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "./models";
import type {
  NativeWorkspace,
  WorkspaceClock,
  WorkspaceLogger,
  WorkspaceRegistry,
} from "./ports";

const NOW = "2026-07-27T09:15:00.000Z";

const record = (
  projectId: string,
  overrides: Partial<WorkspaceProjectRecord> = {},
): WorkspaceProjectRecord => ({
  projectId,
  path: `C:\\shoots\\${projectId}`,
  name: projectId,
  coverImage: `${projectId}.png`,
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  lastOpenedAt: "2026-07-03T00:00:00.000Z",
  ...overrides,
});

const inspected = (
  projectId: string,
  path = `C:\\shoots\\${projectId}`,
  overrides: Partial<InspectedProject> = {},
): InspectedProject => ({
  path,
  manifest: {
    schemaVersion: 1,
    id: projectId,
    name: `Project ${projectId}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    coverImage: `${projectId}-manifest.png`,
  },
  resolvedCoverImage: `${projectId}-resolved.png`,
  coverDataUrl: `data:image/png;base64,${projectId}`,
  ...overrides,
});

describe("createWorkspaceService", () => {
  let createProjectMock: ReturnType<typeof vi.fn<NativeWorkspace["createProject"]>>;
  let inspectProjectMock: ReturnType<typeof vi.fn<NativeWorkspace["inspectProject"]>>;
  let removeCreatedProjectMock: ReturnType<
    typeof vi.fn<NativeWorkspace["removeCreatedProject"]>
  >;
  let onMenuActionMock: ReturnType<typeof vi.fn<NativeWorkspace["onMenuAction"]>>;
  let debugMock: ReturnType<typeof vi.fn<WorkspaceLogger["debug"]>>;
  let infoMock: ReturnType<typeof vi.fn<WorkspaceLogger["info"]>>;
  let warnMock: ReturnType<typeof vi.fn<WorkspaceLogger["warn"]>>;
  let errorMock: ReturnType<typeof vi.fn<WorkspaceLogger["error"]>>;
  let registry: WorkspaceRegistry & {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn<WorkspaceRegistry["save"]>>;
  };
  let native: NativeWorkspace;
  let clock: WorkspaceClock;
  let logger: WorkspaceLogger;

  beforeEach(() => {
    registry = {
      load: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        projects: [],
      } satisfies WorkspaceMetadata),
      save: vi.fn<WorkspaceRegistry["save"]>().mockResolvedValue(undefined),
    };

    createProjectMock = vi.fn<NativeWorkspace["createProject"]>();
    inspectProjectMock = vi.fn<NativeWorkspace["inspectProject"]>();
    removeCreatedProjectMock = vi
      .fn<NativeWorkspace["removeCreatedProject"]>()
      .mockResolvedValue(undefined);
    onMenuActionMock = vi.fn<NativeWorkspace["onMenuAction"]>();
    native = {
      createProject: createProjectMock,
      inspectProject: inspectProjectMock,
      removeCreatedProject: removeCreatedProjectMock,
      onMenuAction: onMenuActionMock,
    };

    clock = {
      now: vi.fn().mockReturnValue(NOW),
    };

    debugMock = vi.fn<WorkspaceLogger["debug"]>();
    infoMock = vi.fn<WorkspaceLogger["info"]>();
    warnMock = vi.fn<WorkspaceLogger["warn"]>();
    errorMock = vi.fn<WorkspaceLogger["error"]>();
    logger = {
      debug: debugMock,
      info: infoMock,
      warn: warnMock,
      error: errorMock,
    };
  });

  it("rolls back a newly created project when registry persistence fails", async () => {
    registry.save.mockRejectedValue(new Error("disk full"));
    createProjectMock.mockResolvedValue(
      inspected("project-1", "C:\\shoots\\Editorial"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.createProject("C:\\shoots", "Editorial"),
    ).rejects.toThrow("Unable to save workspace metadata: disk full");

    expect(removeCreatedProjectMock).toHaveBeenCalledWith(
      "C:\\shoots\\Editorial",
      "project-1",
    );
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("reports both persistence and rollback failures when rollback also fails", async () => {
    registry.save.mockRejectedValue(new Error("disk full"));
    createProjectMock.mockResolvedValue(
      inspected("project-1", "C:\\shoots\\Editorial"),
    );
    removeCreatedProjectMock.mockRejectedValue(new Error("access denied"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.createProject("C:\\shoots", "Editorial"),
    ).rejects.toThrow(
      "Unable to save workspace metadata: disk full; rollback failed: access denied",
    );

    expect(errorMock).toHaveBeenCalledWith(
      "Workspace project rollback failed",
      expect.objectContaining({
        projectId: "project-1",
        reason: "access denied",
      }),
    );
  });

  it("wraps create failures even when the native message already starts with unable to", async () => {
    createProjectMock.mockRejectedValue(new Error("Unable to access folder"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.createProject("C:\\shoots", "Editorial"),
    ).rejects.toThrow(
      "Unable to create workspace project: Unable to access folder",
    );
  });

  it("keeps missing registered projects as unavailable", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [record("missing")],
    });
    inspectProjectMock.mockRejectedValue(new Error("manifest missing"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).resolves.toEqual([
      {
        ...record("missing"),
        status: "unavailable",
        coverDataUrl: null,
      },
    ]);

    expect(warnMock).toHaveBeenCalledWith(
      "Workspace project unavailable",
      {
        projectId: "missing",
        reason: "manifest missing",
      },
    );
  });

  it("keeps mismatched registered projects as unavailable", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [record("expected")],
    });
    inspectProjectMock.mockResolvedValue(
      inspected("different", "D:\\moved-project"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).resolves.toEqual([
      {
        ...record("expected"),
        status: "unavailable",
        coverDataUrl: null,
      },
    ]);

    expect(warnMock).toHaveBeenCalledWith(
      "Workspace project unavailable",
      expect.objectContaining({
        projectId: "expected",
        reason: expect.stringContaining("different"),
      }),
    );
  });

  it("opens an existing project by upserting the same ID and persisting without preview data", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [
        record("project-1", {
          path: "C:\\shoots\\original-location",
          lastOpenedAt: "2026-07-01T00:00:00.000Z",
        }),
      ],
    });
    inspectProjectMock.mockResolvedValue(
      inspected("project-1", "D:\\moved-project"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.openProject("D:\\moved-project")).resolves.toEqual({
      projectId: "project-1",
      path: "D:\\moved-project",
      name: "Project project-1",
      coverImage: "project-1-resolved.png",
      coverDataUrl: "data:image/png;base64,project-1",
      status: "available",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      lastOpenedAt: NOW,
    } satisfies WorkspaceProjectView);

    expect(registry.save).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      projects: [
        {
          projectId: "project-1",
          path: "D:\\moved-project",
          name: "Project project-1",
          coverImage: "project-1-resolved.png",
          status: "available",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          lastOpenedAt: NOW,
        },
      ],
    });
    expect(registry.save.mock.calls.at(-1)?.[0].projects[0]).not.toHaveProperty(
      "coverDataUrl",
    );
    expect(infoMock).toHaveBeenCalledWith("Workspace project opened", {
      projectId: "project-1",
    });
  });

  it("wraps open failures even when the native message already starts with unable to", async () => {
    inspectProjectMock.mockRejectedValue(new Error("Unable to inspect manifest"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.openProject("D:\\moved-project")).rejects.toThrow(
      "Unable to open workspace project: Unable to inspect manifest",
    );
  });

  it("does not mutate metadata when relocation points to a different project ID", async () => {
    inspectProjectMock.mockResolvedValue(inspected("different", "D:\\other"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.relocateProject(record("expected"), "D:\\other"),
    ).rejects.toThrow("different Preshot project");
    expect(registry.save).not.toHaveBeenCalled();
  });

  it("relocates a project after verifying the selected folder belongs to the same ID", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [
        record("project-1", {
          status: "unavailable",
          path: "C:\\missing\\project-1",
        }),
      ],
    });
    inspectProjectMock.mockResolvedValue(
      inspected("project-1", "D:\\restored\\project-1"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.relocateProject(record("project-1"), "D:\\restored\\project-1"),
    ).resolves.toEqual({
      projectId: "project-1",
      path: "D:\\restored\\project-1",
      name: "Project project-1",
      coverImage: "project-1-resolved.png",
      coverDataUrl: "data:image/png;base64,project-1",
      status: "available",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      lastOpenedAt: NOW,
    } satisfies WorkspaceProjectView);

    expect(registry.save).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      projects: [
        {
          projectId: "project-1",
          path: "D:\\restored\\project-1",
          name: "Project project-1",
          coverImage: "project-1-resolved.png",
          status: "available",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          lastOpenedAt: NOW,
        },
      ],
    });
    expect(infoMock).toHaveBeenCalledWith("Workspace project relocated", {
      projectId: "project-1",
    });
  });

  it("wraps relocate failures even when the native message already starts with unable to", async () => {
    inspectProjectMock.mockRejectedValue(new Error("Unable to inspect manifest"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.relocateProject(record("project-1"), "D:\\restored\\project-1"),
    ).rejects.toThrow(
      "Unable to relocate workspace project: Unable to inspect manifest",
    );
  });

  it("removes only the registry record and never rolls back native files", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [
        record("keep", { lastOpenedAt: "2026-07-04T00:00:00.000Z" }),
        record("remove", { lastOpenedAt: "2026-07-02T00:00:00.000Z" }),
      ],
    });
    inspectProjectMock.mockImplementation((path: string) => {
      if (path.endsWith("\\keep")) {
        return Promise.resolve(
          inspected("keep", path, {
            manifest: {
              schemaVersion: 1,
              id: "keep",
              name: "Keep",
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-04T00:00:00.000Z",
              coverImage: "keep-manifest.png",
            },
            resolvedCoverImage: "keep-resolved.png",
            coverDataUrl: "data:image/png;base64,keep",
          }),
        );
      }

      return Promise.resolve(
        inspected("remove", path, {
          manifest: {
            schemaVersion: 1,
            id: "remove",
            name: "Remove",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-04T00:00:00.000Z",
            coverImage: "remove-manifest.png",
          },
          resolvedCoverImage: "remove-resolved.png",
          coverDataUrl: "data:image/png;base64,remove",
        }),
      );
    });
    const service = createWorkspaceService({ registry, native, clock, logger });

    await service.loadProjects();
    await expect(service.removeRecord("remove")).resolves.toEqual([
      {
        projectId: "keep",
        path: "C:\\shoots\\keep",
        name: "Keep",
        coverImage: "keep-resolved.png",
        coverDataUrl: "data:image/png;base64,keep",
        status: "available",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z",
        lastOpenedAt: "2026-07-04T00:00:00.000Z",
      },
    ]);

    expect(removeCreatedProjectMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Workspace project removed", {
      projectId: "remove",
    });
  });

  it.each([
    {
      name: "rejects unsupported schema versions",
      loaded: {
        schemaVersion: 2,
        projects: [],
      },
      message: "Unable to load workspace metadata: Unsupported workspace schema 2",
    },
    {
      name: "surfaces adapter load failures",
      error: new Error("store unavailable"),
      message: "Unable to load workspace metadata: store unavailable",
    },
  ])("$name", async ({ loaded, error, message }) => {
    if (error) {
      registry.load.mockRejectedValue(error);
    } else {
      registry.load.mockResolvedValue(loaded);
    }

    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).rejects.toThrow(message);
    expect(registry.save).not.toHaveBeenCalled();
  });

  it("sorts loaded projects newest first, persists projected records, and reuses the cache", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [
        record("older", { lastOpenedAt: "2026-07-01T00:00:00.000Z" }),
        record("newer", { lastOpenedAt: "2026-07-05T00:00:00.000Z" }),
      ],
    });
    inspectProjectMock.mockImplementation((path: string) => {
      if (path.endsWith("\\older")) {
        return Promise.resolve(inspected("older", path));
      }

      return Promise.resolve(inspected("newer", path));
    });
    createProjectMock.mockResolvedValue(
      inspected("fresh", "C:\\shoots\\Fresh"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).resolves.toEqual([
      expect.objectContaining({
        projectId: "newer",
        lastOpenedAt: "2026-07-05T00:00:00.000Z",
      }),
      expect.objectContaining({
        projectId: "older",
        lastOpenedAt: "2026-07-01T00:00:00.000Z",
      }),
    ]);

    await service.createProject("C:\\shoots", "Fresh");

    expect(registry.load).toHaveBeenCalledTimes(1);
    expect(registry.save.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      projects: [
        {
          projectId: "newer",
          path: "C:\\shoots\\newer",
          name: "Project newer",
          coverImage: "newer-resolved.png",
          status: "available",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          lastOpenedAt: "2026-07-05T00:00:00.000Z",
        },
        {
          projectId: "older",
          path: "C:\\shoots\\older",
          name: "Project older",
          coverImage: "older-resolved.png",
          status: "available",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          lastOpenedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    expect(registry.save.mock.calls[0]?.[0].projects[0]).not.toHaveProperty(
      "coverDataUrl",
    );
  });
});
