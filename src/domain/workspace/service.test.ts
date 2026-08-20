import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceService } from "./service";
import type {
  CreatedProject,
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

const createdProject = (
  projectId: string,
  rollbackToken: string,
  path = `C:\\shoots\\${projectId}`,
  overrides: Partial<InspectedProject> = {},
): CreatedProject => ({
  project: inspected(projectId, path, overrides),
  rollbackToken,
});

const findSaveCallForProject = (
  calls: Array<[WorkspaceMetadata]>,
  projectId: string,
) => calls.find(([metadata]) =>
  metadata.projects.some((project) => project.projectId === projectId),
);

const viewed = (
  projectId: string,
  lastOpenedAt: string,
  path = `C:\\shoots\\${projectId}`,
): WorkspaceProjectView => ({
  projectId,
  path,
  name: `Project ${projectId}`,
  coverImage: `${projectId}-resolved.png`,
  coverDataUrl: `data:image/png;base64,${projectId}`,
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z",
  lastOpenedAt,
});

const persisted = (
  project: WorkspaceProjectView,
): WorkspaceProjectRecord => ({
  projectId: project.projectId,
  path: project.path,
  name: project.name,
  coverImage: project.coverImage,
  status: project.status,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  lastOpenedAt: project.lastOpenedAt,
});

const lastSavedMetadata = (calls: Array<[WorkspaceMetadata]>) => calls.at(-1)?.[0];

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
};

describe("createWorkspaceService", () => {
  let createProjectMock: ReturnType<typeof vi.fn<NativeWorkspace["createProject"]>>;
  let ensureUserDataRootsMock: ReturnType<typeof vi.fn<NativeWorkspace["ensureUserDataRoots"]>>;
  let bootstrapUserDataMock: ReturnType<typeof vi.fn<NativeWorkspace["bootstrapUserData"]>>;
  let inspectProjectMock: ReturnType<typeof vi.fn<NativeWorkspace["inspectProject"]>>;
  let rollbackCreatedProjectMock: ReturnType<typeof vi.fn<(rollbackToken: string) => Promise<void>>>;
  let forgetCreatedProjectMock: ReturnType<typeof vi.fn<(rollbackToken: string) => Promise<void>>>;
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
    rollbackCreatedProjectMock = vi.fn<(rollbackToken: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    forgetCreatedProjectMock = vi.fn<(rollbackToken: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    onMenuActionMock = vi.fn<NativeWorkspace["onMenuAction"]>();
    ensureUserDataRootsMock = vi.fn().mockResolvedValue({
      userRoot: "C:\\Users\\test\\.preshot",
      projectsRoot: "C:\\Users\\test\\.preshot\\projects",
    });
    bootstrapUserDataMock = vi.fn().mockResolvedValue({
      roots: {
        userRoot: "C:\\Users\\test\\.preshot",
        projectsRoot: "C:\\Users\\test\\.preshot\\projects",
      },
      project: null,
      rollbackToken: null,
    });
    native = {
      ensureUserDataRoots: ensureUserDataRootsMock,
      bootstrapUserData: bootstrapUserDataMock,
      createProject: createProjectMock,
      inspectProject: inspectProjectMock,
      rollbackCreatedProject: rollbackCreatedProjectMock,
      forgetCreatedProject: forgetCreatedProjectMock,
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

  it("ensures user roots before reading recents and passes registered identities to bootstrap", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [record("registered")],
    });
    inspectProjectMock.mockResolvedValue(inspected("registered"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await service.loadProjects();

    expect(ensureUserDataRootsMock.mock.invocationCallOrder[0]).toBeLessThan(
      registry.load.mock.invocationCallOrder[0],
    );
    expect(bootstrapUserDataMock).toHaveBeenCalledWith([{
      projectId: "registered",
      path: "C:\\shoots\\registered",
    }]);
  });

  it("registers and returns a newly created starter project", async () => {
    const starter = inspected("starter", "C:\\Users\\test\\.preshot\\projects\\Preshot 入门示例", {
      manifest: {
        schemaVersion: 1,
        id: "starter",
        name: "Preshot 入门示例",
        createdAt: "2026-08-19T15:04:03.669Z",
        updatedAt: "2026-08-19T15:04:03.669Z",
      },
      resolvedCoverImage: null,
      coverDataUrl: null,
    });
    bootstrapUserDataMock.mockResolvedValue({
      roots: {
        userRoot: "C:\\Users\\test\\.preshot",
        projectsRoot: "C:\\Users\\test\\.preshot\\projects",
      },
      project: starter,
      rollbackToken: "starter-token",
    });
    inspectProjectMock.mockResolvedValue(starter);
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).resolves.toEqual([
      expect.objectContaining({
        projectId: "starter",
        name: "Preshot 入门示例",
        status: "available",
      }),
    ]);

    expect(forgetCreatedProjectMock).toHaveBeenCalledWith("starter-token");
    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Starter project created", {
      projectId: "starter",
    });
  });

  it("adopts a valid unregistered default-root project without gaining deletion authority", async () => {
    const adopted = inspected("adopted", "C:\\Users\\test\\.preshot\\projects\\Existing");
    bootstrapUserDataMock.mockResolvedValue({
      roots: {
        userRoot: "C:\\Users\\test\\.preshot",
        projectsRoot: "C:\\Users\\test\\.preshot\\projects",
      },
      project: adopted,
      rollbackToken: null,
    });
    inspectProjectMock.mockResolvedValue(adopted);
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).resolves.toEqual([
      expect.objectContaining({ projectId: "adopted" }),
    ]);

    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
    expect(forgetCreatedProjectMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Default-root project adopted", {
      projectId: "adopted",
    });
  });

  it("rolls back only a newly created starter when registry persistence fails", async () => {
    const starter = inspected("starter", "C:\\Users\\test\\.preshot\\projects\\Preshot 入门示例");
    bootstrapUserDataMock.mockResolvedValue({
      roots: {
        userRoot: "C:\\Users\\test\\.preshot",
        projectsRoot: "C:\\Users\\test\\.preshot\\projects",
      },
      project: starter,
      rollbackToken: "starter-token",
    });
    registry.save.mockRejectedValue(new Error("registry is read-only"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).rejects.toThrow(
      "Unable to save workspace metadata: registry is read-only",
    );
    expect(rollbackCreatedProjectMock).toHaveBeenCalledWith("starter-token");
  });

  it("never rolls back an adopted project when registry persistence fails", async () => {
    bootstrapUserDataMock.mockResolvedValue({
      roots: {
        userRoot: "C:\\Users\\test\\.preshot",
        projectsRoot: "C:\\Users\\test\\.preshot\\projects",
      },
      project: inspected("adopted", "C:\\Users\\test\\.preshot\\projects\\Existing"),
      rollbackToken: null,
    });
    registry.save.mockRejectedValue(new Error("registry is read-only"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).rejects.toThrow("registry is read-only");
    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
  });

  it("runs bootstrap once across concurrent and repeated startup loads", async () => {
    const service = createWorkspaceService({ registry, native, clock, logger });

    await Promise.all([service.loadProjects(), service.loadProjects()]);
    await service.loadProjects();

    expect(ensureUserDataRootsMock).toHaveBeenCalledTimes(1);
    expect(bootstrapUserDataMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces root creation failures before touching the registry", async () => {
    ensureUserDataRootsMock.mockRejectedValue(new Error("access denied"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).rejects.toThrow(
      "Unable to prepare Preshot user data folders: access denied",
    );
    expect(registry.load).not.toHaveBeenCalled();
    expect(bootstrapUserDataMock).not.toHaveBeenCalled();
  });

  it("rolls back a newly created project when registry persistence fails", async () => {
    registry.save.mockRejectedValue(new Error("disk full"));
    createProjectMock.mockResolvedValue(
      createdProject("project-1", "rollback-token-1", "C:\\shoots\\Editorial"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.createProject("C:\\shoots", "Editorial"),
    ).rejects.toThrow("Unable to save workspace metadata: disk full");

    expect(rollbackCreatedProjectMock).toHaveBeenCalledWith("rollback-token-1");
    expect(forgetCreatedProjectMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("reports both persistence and rollback failures when rollback also fails", async () => {
    registry.save.mockRejectedValue(new Error("disk full"));
    createProjectMock.mockResolvedValue(
      createdProject("project-1", "rollback-token-1", "C:\\shoots\\Editorial"),
    );
    rollbackCreatedProjectMock.mockRejectedValue(new Error("access denied"));
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

  it("rolls back a newly created project with its rollback token when registry persistence fails", async () => {
    registry.save.mockRejectedValue(new Error("disk full"));
    createProjectMock.mockResolvedValue(
      createdProject("project-1", "rollback-token-1", "C:\\shoots\\Editorial"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(
      service.createProject("C:\\shoots", "Editorial"),
    ).rejects.toThrow("Unable to save workspace metadata: disk full");

    expect(rollbackCreatedProjectMock).toHaveBeenCalledWith("rollback-token-1");
    expect(forgetCreatedProjectMock).not.toHaveBeenCalled();
  });

  it("forgets a rollback token after successful metadata persistence and never rolls back", async () => {
    createProjectMock.mockResolvedValue(
      createdProject("project-1", "rollback-token-1", "C:\\shoots\\Editorial"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.createProject("C:\\shoots", "Editorial")).resolves.toEqual(
      viewed("project-1", NOW, "C:\\shoots\\Editorial"),
    );
    expect(forgetCreatedProjectMock).toHaveBeenCalledWith("rollback-token-1");
    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
  });

  it("logs rollback token forget failures without deleting the durable project", async () => {
    createProjectMock.mockResolvedValue(
      createdProject("project-1", "rollback-token-1", "C:\\shoots\\Editorial"),
    );
    forgetCreatedProjectMock.mockRejectedValue(new Error("bridge unavailable"));
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.createProject("C:\\shoots", "Editorial")).resolves.toEqual(
      viewed("project-1", NOW, "C:\\shoots\\Editorial"),
    );

    expect(errorMock).toHaveBeenCalledWith(
      "Workspace project rollback token forget failed",
      {
        projectId: "project-1",
        reason: "bridge unavailable",
      },
    );
    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
    expect(JSON.stringify(errorMock.mock.calls)).not.toContain("rollback-token-1");
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

  it("reports contextual metadata save failures after load validation succeeds", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [record("project-1")],
    });
    inspectProjectMock.mockResolvedValue(inspected("project-1"));
    const saveError = new Error("disk full");
    registry.save.mockRejectedValue(saveError);
    const service = createWorkspaceService({ registry, native, clock, logger });

    const loadProjectsPromise = service.loadProjects();

    await expect(loadProjectsPromise).rejects.toMatchObject({
      message: "Unable to save workspace metadata: disk full",
      cause: saveError,
    });
    expect(registry.save).toHaveBeenCalledTimes(1);
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("creates projects with persisted metadata and logs the project without preview data", async () => {
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [],
    });
    createProjectMock.mockResolvedValue(
      createdProject("project-1", "rollback-token-1", "C:\\shoots\\Editorial"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    await expect(service.loadProjects()).resolves.toEqual([]);
    await expect(service.createProject("C:\\shoots", "Editorial")).resolves.toEqual(
      {
        projectId: "project-1",
        path: "C:\\shoots\\Editorial",
        name: "Project project-1",
        coverImage: "project-1-resolved.png",
        coverDataUrl: "data:image/png;base64,project-1",
        status: "available",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z",
        lastOpenedAt: NOW,
      } satisfies WorkspaceProjectView,
    );

    const createSaveCall = findSaveCallForProject(
      registry.save.mock.calls,
      "project-1",
    );

    expect(registry.load).toHaveBeenCalledTimes(1);
    expect(createSaveCall?.[0]).toEqual({
      schemaVersion: 1,
      projects: [
        {
          projectId: "project-1",
          path: "C:\\shoots\\Editorial",
          name: "Project project-1",
          coverImage: "project-1-resolved.png",
          status: "available",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          lastOpenedAt: NOW,
        },
      ],
    });
    expect(createSaveCall?.[0].projects[0]).not.toHaveProperty("coverDataUrl");
    expect(infoMock).toHaveBeenCalledWith("Workspace project created", {
      projectId: "project-1",
    });
    expect(infoMock.mock.calls.at(-1)?.[1]).not.toHaveProperty("coverDataUrl");
    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
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

    expect(rollbackCreatedProjectMock).not.toHaveBeenCalled();
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
      createdProject("fresh", "rollback-token-fresh", "C:\\shoots\\Fresh"),
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
    const createSaveCall = findSaveCallForProject(
      registry.save.mock.calls,
      "fresh",
    );

    expect(createSaveCall?.[0]).toEqual({
      schemaVersion: 1,
      projects: [
        {
          projectId: "fresh",
          path: "C:\\shoots\\Fresh",
          name: "Project fresh",
          coverImage: "fresh-resolved.png",
          status: "available",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
          lastOpenedAt: NOW,
        },
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
    expect(createSaveCall?.[0].projects[0]).not.toHaveProperty("coverDataUrl");
  });

  it("keeps both concurrent createProject results in persistence and cache", async () => {
    const firstCreated = deferred<CreatedProject>();
    const secondCreated = deferred<CreatedProject>();
    createProjectMock
      .mockImplementationOnce(() => firstCreated.promise)
      .mockImplementationOnce(() => secondCreated.promise);
    inspectProjectMock.mockImplementation((path: string) => {
      if (path.endsWith("\\alpha")) {
        return Promise.resolve(inspected("alpha", path));
      }

      return Promise.resolve(inspected("beta", path));
    });
    const service = createWorkspaceService({ registry, native, clock, logger });

    const firstCreate = service.createProject("C:\\shoots", "Alpha");
    const secondCreate = service.createProject("C:\\shoots", "Beta");

    firstCreated.resolve(
      createdProject("alpha", "rollback-token-alpha", "C:\\shoots\\alpha"),
    );
    secondCreated.resolve(
      createdProject("beta", "rollback-token-beta", "C:\\shoots\\beta"),
    );

    await expect(Promise.all([firstCreate, secondCreate])).resolves.toEqual([
      viewed("alpha", NOW, "C:\\shoots\\alpha"),
      viewed("beta", NOW, "C:\\shoots\\beta"),
    ]);
    await expect(service.loadProjects()).resolves.toEqual([
      viewed("alpha", NOW, "C:\\shoots\\alpha"),
      viewed("beta", NOW, "C:\\shoots\\beta"),
    ]);

    expect(lastSavedMetadata(registry.save.mock.calls)).toEqual({
      schemaVersion: 1,
      projects: [
        persisted(viewed("alpha", NOW, "C:\\shoots\\alpha")),
        persisted(viewed("beta", NOW, "C:\\shoots\\beta")),
      ],
    });
  });

  it("does not let mutated loadProjects results corrupt a later createProject save", async () => {
    const keepProject = viewed("keep", "2026-07-05T00:00:00.000Z");
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [record("keep", { lastOpenedAt: keepProject.lastOpenedAt })],
    });
    inspectProjectMock.mockResolvedValue(inspected("keep"));
    createProjectMock.mockResolvedValue(
      createdProject("fresh", "rollback-token-fresh", "C:\\shoots\\fresh"),
    );
    const service = createWorkspaceService({ registry, native, clock, logger });

    const loadedProjects = await service.loadProjects();
    loadedProjects[0]!.name = "Corrupted Keep";
    loadedProjects[0]!.path = "C:\\corrupted\\keep";
    loadedProjects[0]!.coverImage = "corrupted.png";
    loadedProjects[0]!.coverDataUrl = "data:image/png;base64,corrupted";
    loadedProjects.push(viewed("rogue", "2026-07-06T00:00:00.000Z"));

    await expect(service.createProject("C:\\shoots", "Fresh")).resolves.toEqual(
      viewed("fresh", NOW, "C:\\shoots\\fresh"),
    );

    expect(lastSavedMetadata(registry.save.mock.calls)).toEqual({
      schemaVersion: 1,
      projects: [
        persisted(viewed("fresh", NOW, "C:\\shoots\\fresh")),
        persisted(keepProject),
      ],
    });
  });

  it("does not let mutated loadProjects results corrupt a later openProject save", async () => {
    const keepProject = viewed("keep", "2026-07-05T00:00:00.000Z");
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [record("keep", { lastOpenedAt: keepProject.lastOpenedAt })],
    });
    inspectProjectMock.mockImplementation((path: string) => {
      if (path === "D:\\opened\\opened") {
        return Promise.resolve(inspected("opened", path));
      }

      return Promise.resolve(inspected("keep", path));
    });
    const service = createWorkspaceService({ registry, native, clock, logger });

    const loadedProjects = await service.loadProjects();
    loadedProjects[0]!.name = "Corrupted Keep";
    loadedProjects[0]!.path = "C:\\corrupted\\keep";
    loadedProjects[0]!.coverImage = "corrupted.png";
    loadedProjects[0]!.coverDataUrl = "data:image/png;base64,corrupted";
    loadedProjects.push(viewed("rogue", "2026-07-06T00:00:00.000Z"));

    await expect(service.openProject("D:\\opened\\opened")).resolves.toEqual(
      viewed("opened", NOW, "D:\\opened\\opened"),
    );

    expect(lastSavedMetadata(registry.save.mock.calls)).toEqual({
      schemaVersion: 1,
      projects: [
        persisted(viewed("opened", NOW, "D:\\opened\\opened")),
        persisted(keepProject),
      ],
    });
  });

  it("does not let mutated loadProjects results corrupt a later removeRecord save", async () => {
    const keepProject = viewed("keep", "2026-07-05T00:00:00.000Z");
    const removeProject = viewed("remove", "2026-07-04T00:00:00.000Z");
    registry.load.mockResolvedValue({
      schemaVersion: 1,
      projects: [
        record("keep", { lastOpenedAt: keepProject.lastOpenedAt }),
        record("remove", { lastOpenedAt: removeProject.lastOpenedAt }),
      ],
    });
    inspectProjectMock.mockImplementation((path: string) => {
      if (path.endsWith("\\remove")) {
        return Promise.resolve(inspected("remove", path));
      }

      return Promise.resolve(inspected("keep", path));
    });
    const service = createWorkspaceService({ registry, native, clock, logger });

    const loadedProjects = await service.loadProjects();
    loadedProjects[0]!.name = "Corrupted Keep";
    loadedProjects[0]!.path = "C:\\corrupted\\keep";
    loadedProjects[0]!.coverImage = "corrupted.png";
    loadedProjects[0]!.coverDataUrl = "data:image/png;base64,corrupted";
    loadedProjects.push(viewed("rogue", "2026-07-06T00:00:00.000Z"));

    await expect(service.removeRecord("remove")).resolves.toEqual([keepProject]);

    expect(lastSavedMetadata(registry.save.mock.calls)).toEqual({
      schemaVersion: 1,
      projects: [persisted(keepProject)],
    });
  });

  it("continues queued workspace operations after a rejected operation", async () => {
    const firstCreated = deferred<CreatedProject>();
    const secondCreated = deferred<CreatedProject>();
    createProjectMock
      .mockImplementationOnce(() => firstCreated.promise)
      .mockImplementationOnce(() => secondCreated.promise);
    const service = createWorkspaceService({ registry, native, clock, logger });

    const rejectedCreate = service.createProject("C:\\shoots", "Broken");
    const recoveredCreate = service.createProject("C:\\shoots", "Recovered");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createProjectMock).toHaveBeenCalledTimes(1);

    firstCreated.reject(new Error("Unable to access folder"));
    secondCreated.resolve(
      createdProject("recovered", "rollback-token-recovered", "C:\\shoots\\recovered"),
    );

    await expect(rejectedCreate).rejects.toThrow(
      "Unable to create workspace project: Unable to access folder",
    );
    await expect(recoveredCreate).resolves.toEqual(
      viewed("recovered", NOW, "C:\\shoots\\recovered"),
    );
    expect(createProjectMock).toHaveBeenCalledTimes(2);
  });
});
