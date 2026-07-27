import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "../../domain/workspace/models";
import type {
  WorkspaceLogger,
  WorkspaceMenuAction,
  WorkspaceService,
} from "../../domain/workspace/ports";
import type { WorkspaceDependencies } from "./dependencies";
import { WorkspaceProvider } from "./WorkspaceProvider";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function makeProject(
  overrides: Partial<WorkspaceProjectView> = {},
): WorkspaceProjectView {
  return {
    projectId: "editorial",
    path: "C:\\shoots\\Editorial",
    name: "Editorial",
    coverImage: null,
    coverDataUrl: null,
    status: "available",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    lastOpenedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

function toRecord(project: WorkspaceProjectView): WorkspaceProjectRecord {
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

function createDependencies() {
  const service: WorkspaceService = {
    loadProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    openProject: vi.fn(),
    relocateProject: vi.fn(),
    removeRecord: vi.fn(),
  };
  const pickDirectory = vi.fn().mockResolvedValue(null);
  const unlisten = vi.fn();
  let menuHandler: ((action: WorkspaceMenuAction) => void) | null = null;

  const logger: WorkspaceLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const dependencies: WorkspaceDependencies = {
    service,
    directoryPicker: {
      pickDirectory,
    },
    native: {
      onMenuAction: vi.fn(async (handler: (action: WorkspaceMenuAction) => void) => {
        menuHandler = handler;
        return unlisten;
      }),
    },
    logger,
  };

  return {
    dependencies,
    service,
    pickDirectory,
    logger,
    native: dependencies.native,
    unlisten,
    emitMenuAction(action: WorkspaceMenuAction) {
      if (!menuHandler) {
        throw new Error("Expected WorkspaceProvider to register a menu listener.");
      }

      menuHandler(action);
    },
  };
}

describe("WorkspaceProvider", () => {
  it("shows initial loading and then renders launcher projects", async () => {
    const project = makeProject();
    const { promise, resolve } = deferred<WorkspaceProjectView[]>();
    const { dependencies, service, native } = createDependencies();
    vi.mocked(service.loadProjects).mockReturnValueOnce(promise);

    render(<WorkspaceProvider dependencies={dependencies} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading recent projects",
    );

    await act(async () => {
      resolve([project]);
    });

    expect(
      await screen.findByRole("button", { name: "Open project Editorial" }),
    ).toBeVisible();
    expect(native.onMenuAction).toHaveBeenCalledTimes(1);
  });

  it("opens an available project through the service and shows the workspace view", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const openedProject = makeProject({
      lastOpenedAt: "2026-07-04T00:00:00.000Z",
    });
    const { dependencies, service } = createDependencies();
    vi.mocked(service.loadProjects).mockResolvedValue([project]);
    vi.mocked(service.openProject).mockResolvedValue(openedProject);

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(
      await screen.findByRole("button", { name: "Open project Editorial" }),
    );

    expect(service.openProject).toHaveBeenCalledWith(project.path);
    expect(await screen.findByText("Editorial")).toBeVisible();
    expect(screen.getByText("Start your photography plan")).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Planning tools" }),
    ).toBeVisible();
  });

  it("shows a recoverable load error while keeping the open action enabled", async () => {
    const { dependencies, service } = createDependencies();
    vi.mocked(service.loadProjects).mockRejectedValueOnce(
      new Error("metadata corrupt"),
    );

    render(<WorkspaceProvider dependencies={dependencies} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "metadata corrupt",
    );
    expect(screen.getByRole("button", { name: "Open project" })).toBeEnabled();
  });

  it("does not open the project-name dialog when parent selection is cancelled", async () => {
    const user = userEvent.setup();
    const { dependencies, pickDirectory, service } = createDependencies();

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(await screen.findByRole("button", { name: "New project" }));

    expect(pickDirectory).toHaveBeenCalledWith(
      "Select parent folder for the new Preshot project",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(service.createProject).not.toHaveBeenCalled();
  });

  it("picks the parent directory before opening the create dialog and then opens the created project", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const { promise, resolve } = deferred<string | null>();
    const { dependencies, pickDirectory, service } = createDependencies();
    vi.mocked(pickDirectory).mockReturnValueOnce(promise);
    vi.mocked(service.createProject).mockResolvedValue(project);

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(await screen.findByRole("button", { name: "New project" }));

    expect(pickDirectory).toHaveBeenCalledWith(
      "Select parent folder for the new Preshot project",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      resolve("C:\\shoots");
    });

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Project name"), "  Editorial  ");
    await user.click(
      within(dialog).getByRole("button", { name: "Create project" }),
    );

    expect(service.createProject).toHaveBeenCalledWith("C:\\shoots", "Editorial");
    expect(await screen.findByText("Editorial")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the create dialog open with the trimmed value when creation fails", async () => {
    const user = userEvent.setup();
    const { dependencies, pickDirectory, service } = createDependencies();
    vi.mocked(pickDirectory).mockResolvedValueOnce("C:\\shoots");
    vi.mocked(service.createProject).mockRejectedValueOnce(
      new Error("name already exists"),
    );

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByLabelText("Project name"),
      "  Editorial Retry  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create project" }),
    );

    expect(service.createProject).toHaveBeenCalledWith(
      "C:\\shoots",
      "Editorial Retry",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "name already exists",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("Project name")).toHaveValue("Editorial Retry");
  });

  it("does nothing when opening an existing project is cancelled", async () => {
    const user = userEvent.setup();
    const { dependencies, service } = createDependencies();

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(await screen.findByRole("button", { name: "Open project" }));

    expect(service.openProject).not.toHaveBeenCalled();
    expect(screen.getByText("Start your next photography plan")).toBeVisible();
  });

  it("opens an existing project selected from the directory picker", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const { dependencies, pickDirectory, service } = createDependencies();
    vi.mocked(pickDirectory).mockResolvedValueOnce(project.path);
    vi.mocked(service.openProject).mockResolvedValue(project);

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(await screen.findByRole("button", { name: "Open project" }));

    expect(service.openProject).toHaveBeenCalledWith(project.path);
    expect(await screen.findByText("Editorial")).toBeVisible();
  });

  it("relocates unavailable projects and removes stale records from the launcher", async () => {
    const user = userEvent.setup();
    const missingProject = makeProject({
      projectId: "missing",
      name: "Missing Archive",
      path: "C:\\missing\\archive",
      status: "unavailable",
    });
    const staleProject = makeProject({
      projectId: "stale",
      name: "Stale Archive",
      path: "C:\\missing\\stale",
      status: "unavailable",
    });
    const relocatedProject = makeProject({
      projectId: "missing",
      name: "Missing Archive",
      path: "D:\\restored\\missing",
    });
    const { dependencies, pickDirectory, service } = createDependencies();
    vi.mocked(service.loadProjects).mockResolvedValue([missingProject, staleProject]);
    vi.mocked(pickDirectory).mockResolvedValueOnce("D:\\restored\\missing");
    vi.mocked(service.relocateProject).mockResolvedValue(relocatedProject);
    vi.mocked(service.removeRecord).mockResolvedValue([relocatedProject]);

    render(<WorkspaceProvider dependencies={dependencies} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Relocate project Missing Archive",
      }),
    );

    expect(service.relocateProject).toHaveBeenCalledWith(
      toRecord(missingProject),
      "D:\\restored\\missing",
    );
    expect(
      await screen.findByRole("button", { name: "Open project Missing Archive" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Remove Stale Archive from recent projects",
      }),
    );

    expect(service.removeRecord).toHaveBeenCalledWith("stale");
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Relocate project Stale Archive" }),
      ).not.toBeInTheDocument();
    });
  });

  it("uses the same picker and service flow for a native open-project menu action", async () => {
    const project = makeProject();
    const { dependencies, emitMenuAction, pickDirectory, service } =
      createDependencies();
    vi.mocked(pickDirectory).mockResolvedValueOnce(project.path);
    vi.mocked(service.openProject).mockResolvedValue(project);

    render(<WorkspaceProvider dependencies={dependencies} />);

    await screen.findByRole("button", { name: "New project" });

    await act(async () => {
      emitMenuAction("open-project");
    });

    await waitFor(() => {
      expect(service.openProject).toHaveBeenCalledWith(project.path);
    });
    expect(await screen.findByText("Editorial")).toBeVisible();
  });

  it("uses the same parent-first dialog flow for a native new-project menu action", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const { promise, resolve } = deferred<string | null>();
    const { dependencies, emitMenuAction, pickDirectory, service } =
      createDependencies();
    vi.mocked(pickDirectory).mockReturnValueOnce(promise);
    vi.mocked(service.createProject).mockResolvedValue(project);

    render(<WorkspaceProvider dependencies={dependencies} />);

    await screen.findByRole("button", { name: "New project" });

    await act(async () => {
      emitMenuAction("new-project");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      resolve("C:\\shoots");
    });

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Project name"), "Editorial");
    await user.click(
      within(dialog).getByRole("button", { name: "Create project" }),
    );

    expect(service.createProject).toHaveBeenCalledWith("C:\\shoots", "Editorial");
    expect(await screen.findByText("Editorial")).toBeVisible();
  });

  it("cleans up the menu listener and ignores async completions after unmount", async () => {
    const { promise, resolve } = deferred<WorkspaceProjectView[]>();
    const { dependencies, emitMenuAction, native, pickDirectory, service, unlisten } =
      createDependencies();
    vi.mocked(service.loadProjects).mockReturnValueOnce(promise);

    const { unmount } = render(<WorkspaceProvider dependencies={dependencies} />);

    await waitFor(() => {
      expect(native.onMenuAction).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);

    emitMenuAction("open-project");
    expect(pickDirectory).not.toHaveBeenCalled();

    await act(async () => {
      resolve([makeProject()]);
    });
  });
});
