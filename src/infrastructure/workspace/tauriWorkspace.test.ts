import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreatedProject,
  InspectedProject,
} from "../../domain/workspace/models";
import type { WorkspaceLogger } from "../../domain/workspace/ports";
import {
  createTauriWorkspace,
  WorkspaceNativeError,
} from "./tauriWorkspace";

const inspectedProject = (
  overrides: Partial<InspectedProject> = {},
): InspectedProject => ({
  path: "C:\\shoots\\project-1",
  manifest: {
    schemaVersion: 1,
    id: "project-1",
    name: "Project 1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    coverImage: "cover.png",
  },
  resolvedCoverImage: "cover.png",
  coverDataUrl: "data:image/png;base64,preview",
  ...overrides,
});

const createdProject = (
  overrides: Partial<CreatedProject> = {},
): CreatedProject => ({
  project: inspectedProject(),
  rollbackToken: "rollback-token-1",
  ...overrides,
});

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type ListenForEvent = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

function expectNativeError(
  error: unknown,
  message: string,
  cause: unknown,
  code?: string,
): void {
  expect(error).toBeInstanceOf(WorkspaceNativeError);

  if (!(error instanceof WorkspaceNativeError)) {
    throw error;
  }

  expect(error.message).toBe(message);
  expect(error.cause).toBe(cause);
  expect(error.code).toBe(code);
}

describe("createTauriWorkspace", () => {
  let invokeCommand: ReturnType<typeof vi.fn<InvokeCommand>>;
  let listenForEvent: ReturnType<typeof vi.fn<ListenForEvent>>;
  let warn: ReturnType<typeof vi.fn<WorkspaceLogger["warn"]>>;
  let logger: WorkspaceLogger;

  beforeEach(() => {
    invokeCommand = vi.fn<InvokeCommand>();
    listenForEvent = vi.fn<ListenForEvent>();
    warn = vi.fn<WorkspaceLogger["warn"]>();
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };
  });

  it("invokes create_project with camelCase args and returns a typed created project", async () => {
    const result = createdProject();
    invokeCommand.mockResolvedValue(result);
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(
      workspace.createProject("C:\\shoots", "Project 1"),
    ).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledWith("create_project", {
      parentPath: "C:\\shoots",
      name: "Project 1",
    });
  });

  it("invokes inspect_project with the requested path and returns a typed project", async () => {
    const result = inspectedProject();
    invokeCommand.mockResolvedValue(result);
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(workspace.inspectProject("C:\\shoots\\project-1")).resolves.toEqual(
      result,
    );
    expect(invokeCommand).toHaveBeenCalledWith("inspect_project", {
      path: "C:\\shoots\\project-1",
    });
  });

  it("accepts an empty manifest coverImage while preserving the manifest response", async () => {
    const result = inspectedProject({
      manifest: {
        schemaVersion: 1,
        id: "project-1",
        name: "Project 1",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        coverImage: "",
      },
      resolvedCoverImage: "cover.png",
      coverDataUrl: "data:image/png;base64,preview",
    });
    invokeCommand.mockResolvedValue(result);
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(workspace.inspectProject("C:\\shoots\\project-1")).resolves.toEqual(
      result,
    );
    expect(invokeCommand).toHaveBeenCalledWith("inspect_project", {
      path: "C:\\shoots\\project-1",
    });
  });

  it("wraps structured native failures with operation context and code", async () => {
    const failure = {
      code: "manifest_missing",
      message: "Missing .preshot",
    };
    invokeCommand.mockRejectedValue(failure);
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    try {
      await workspace.inspectProject("C:\\shoots\\project-1");
    } catch (error) {
      expectNativeError(
        error,
        "Unable to inspect Preshot project: Missing .preshot",
        failure,
        "manifest_missing",
      );
      return;
    }

    throw new Error("Expected inspectProject() to reject");
  });

  it("rejects malformed create project payloads", async () => {
    invokeCommand.mockResolvedValue({
      project: inspectedProject(),
      rollbackToken: null,
    });
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(
      workspace.createProject("C:\\shoots", "Project 1"),
    ).rejects.toThrow(
      "Unable to create Preshot project: Malformed native response",
    );
  });

  it("rejects malformed inspected project payloads", async () => {
    invokeCommand.mockResolvedValue({
      ...inspectedProject(),
      coverDataUrl: 42,
    });
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(workspace.inspectProject("C:\\shoots\\project-1")).rejects.toThrow(
      "Unable to inspect Preshot project: Malformed native response",
    );
  });

  it("removes created projects with the rollback token only", async () => {
    invokeCommand.mockResolvedValue(undefined);
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(
      workspace.rollbackCreatedProject("rollback-token-1"),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledWith("rollback_created_project", {
      rollbackToken: "rollback-token-1",
    });
  });

  it("forgets created projects with the rollback token only", async () => {
    invokeCommand.mockResolvedValue(undefined);
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(
      workspace.forgetCreatedProject("rollback-token-1"),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledWith("forget_created_project", {
      rollbackToken: "rollback-token-1",
    });
  });

  it.each([
    [
      "createProject",
      "create_project",
      () => createTauriWorkspace({ invokeCommand, listenForEvent, logger }).createProject(
        "C:\\shoots",
        "Project 1",
      ),
      {
        parentPath: "C:\\shoots",
        name: "Project 1",
      },
      createdProject(),
    ],
    [
      "inspectProject",
      "inspect_project",
      () =>
        createTauriWorkspace({ invokeCommand, listenForEvent, logger }).inspectProject(
          "C:\\shoots\\project-1",
        ),
      {
        path: "C:\\shoots\\project-1",
      },
      inspectedProject(),
    ],
    [
      "rollbackCreatedProject",
      "rollback_created_project",
      () =>
        createTauriWorkspace({
          invokeCommand,
          listenForEvent,
          logger,
        }).rollbackCreatedProject("rollback-token-1"),
      {
        rollbackToken: "rollback-token-1",
      },
      undefined,
    ],
    [
      "forgetCreatedProject",
      "forget_created_project",
      () =>
        createTauriWorkspace({
          invokeCommand,
          listenForEvent,
          logger,
        }).forgetCreatedProject("rollback-token-1"),
      {
        rollbackToken: "rollback-token-1",
      },
      undefined,
    ],
  ])(
    "invokes %s using the backend-registered %s command",
    async (_methodName, command, invokeWorkspaceMethod, args, expectedResult) => {
      invokeCommand.mockResolvedValue(expectedResult);

      await expect(invokeWorkspaceMethod()).resolves.toEqual(expectedResult);

      expect(invokeCommand).toHaveBeenCalledWith(command, args);
    },
  );

  it("maps supported menu events and returns the unlisten function", async () => {
    const unlisten = vi.fn<() => void>();
    listenForEvent.mockImplementation(
      async (_event: string, handler: (event: { payload: unknown }) => void) => {
        handler({ payload: "open-project" });
        handler({ payload: "new-project" });
        return unlisten;
      },
    );
    const handler = vi.fn();
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await expect(workspace.onMenuAction(handler)).resolves.toBe(unlisten);
    expect(listenForEvent).toHaveBeenCalledWith(
      "workspace://menu",
      expect.any(Function),
    );
    expect(handler.mock.calls).toEqual([["open-project"], ["new-project"]]);
  });

  it("ignores unknown menu payloads without invoking the handler", async () => {
    const unlisten = vi.fn<() => void>();
    listenForEvent.mockImplementation(
      async (_event: string, handler: (event: { payload: unknown }) => void) => {
        handler({ payload: "unexpected-action" });
        return unlisten;
      },
    );
    const handler = vi.fn();
    const workspace = createTauriWorkspace({
      invokeCommand,
      listenForEvent,
      logger,
    });

    await workspace.onMenuAction(handler);

    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Ignoring unknown workspace menu action", {
      payload: "unexpected-action",
    });
  });
});
