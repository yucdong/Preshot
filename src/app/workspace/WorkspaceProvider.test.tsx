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
import type { CanvasPlanDependencies } from "../../features/plan/ProjectCanvasProvider";
import type { WorkspaceDependencies } from "./dependencies";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";

// Minimal fake repository for tests
const fakeRepository: SettingsRepository = {
  read: async () => ({ theme: "system" }),
  write: async () => {},
};

vi.mock("../../features/plan/canvas/PlanCanvas", () => ({
  PlanCanvas: () => <div data-testid="plan-canvas">Canvas Mock</div>,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function planDeps(): CanvasPlanDependencies {
  return {
    service: {
      loadPlan: vi.fn().mockResolvedValue({ components: [] }),
      loadImage: vi.fn().mockResolvedValue(""),
      savePlan: vi.fn(),
      removeComponent: vi.fn(),
      importImage: vi.fn(),
      importImages: vi.fn(),
      removeImage: vi.fn(),
    },
    picker: {
      pickImageFile: vi.fn().mockResolvedValue(null),
      pickImageFiles: vi.fn().mockResolvedValue([]),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    exporter: { export: vi.fn() },
    saver: { save: vi.fn() },
    reveal: { reveal: vi.fn() },
  };
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

// Helper to wrap components in ThemeProvider for testing
function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider repository={fakeRepository}>{ui}</ThemeProvider>);
}

describe("WorkspaceProvider", () => {
  it("shows initial loading and then auto-opens the most recently edited project", async () => {
    const project = makeProject();
    const { promise, resolve } = deferred<WorkspaceProjectView[]>();
    const { dependencies, service, native } = createDependencies();
    vi.mocked(service.loadProjects).mockReturnValueOnce(promise);

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "正在加载最近的项目",
    );

    await act(async () => {
      resolve([project]);
    });

    const nav = await screen.findByRole("navigation", { name: "项目" });
    expect(
      within(nav).getByRole("button", { name: "打开项目 Editorial" }),
    ).toHaveAttribute("aria-current", "page");
    expect(native.onMenuAction).toHaveBeenCalledTimes(1);
  });

  it("auto-opens the most recently edited project and switches via the sidebar", async () => {
    const user = userEvent.setup();
    const current = makeProject({
      projectId: "editorial",
      name: "Editorial",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    const other = makeProject({
      projectId: "sunset",
      name: "Sunset Shanghai",
      path: "C:\\shoots\\Sunset",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    const openedOther = makeProject({
      projectId: "sunset",
      name: "Sunset Shanghai",
      path: "C:\\shoots\\Sunset",
      lastOpenedAt: "2026-07-10T00:00:00.000Z",
    });
    const { dependencies, service } = createDependencies();
    vi.mocked(service.loadProjects).mockResolvedValue([other, current]);
    vi.mocked(service.openProject).mockResolvedValue(openedOther);

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    expect(
      await screen.findByRole("button", { name: "打开项目 Editorial" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await screen.findByTestId("plan-canvas"),
    ).toBeVisible();
    expect(screen.getByRole("navigation", { name: "项目" })).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "打开项目 Sunset Shanghai" }),
    );

    expect(service.openProject).toHaveBeenCalledWith(other.path);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "打开项目 Sunset Shanghai" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });

  it("shows a recoverable load error while keeping the open action enabled", async () => {
    const { dependencies, service } = createDependencies();
    vi.mocked(service.loadProjects).mockRejectedValueOnce(
      new Error("metadata corrupt"),
    );

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "操作未能完成，请重试。",
    );
    expect(screen.getByRole("button", { name: "打开项目" })).toBeEnabled();
  });

  it("does not open the project-name dialog when parent selection is cancelled", async () => {
    const user = userEvent.setup();
    const { dependencies, pickDirectory, service } = createDependencies();

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));

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

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));

    expect(pickDirectory).toHaveBeenCalledWith(
      "Select parent folder for the new Preshot project",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      resolve("C:\\shoots");
    });

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("项目名称"), "  Editorial  ");
    await user.click(
      within(dialog).getByRole("button", { name: "创建项目" }),
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

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByLabelText("项目名称"),
      "  Editorial Retry  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "创建项目" }),
    );

    expect(service.createProject).toHaveBeenCalledWith(
      "C:\\shoots",
      "Editorial Retry",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "操作未能完成，请重试。",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("项目名称")).toHaveValue("Editorial Retry");
  });

  it("keeps the create dialog open when a create submission is skipped because another action is busy", async () => {
    const user = userEvent.setup();
    const { dependencies, emitMenuAction, pickDirectory, service } =
      createDependencies();
    vi.mocked(pickDirectory)
      .mockResolvedValueOnce("C:\\shoots")
      .mockReturnValueOnce(new Promise<string | null>(() => undefined));

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    await screen.findByRole("dialog");

    await act(async () => {
      emitMenuAction("open-project");
    });

    await user.type(screen.getByLabelText("项目名称"), "Editorial");
    await user.click(
      screen.getByRole("button", { name: "创建项目" }),
    );

    expect(service.createProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("项目名称")).toHaveValue("Editorial");
  });

  it("does nothing when opening an existing project is cancelled", async () => {
    const user = userEvent.setup();
    const { dependencies, service } = createDependencies();

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(await screen.findByRole("button", { name: "打开项目" }));

    expect(service.openProject).not.toHaveBeenCalled();
    expect(screen.getByText("开始你的下一个摄影计划")).toBeVisible();
  });

  it("opens an existing project selected from the directory picker", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const { dependencies, pickDirectory, service } = createDependencies();
    vi.mocked(pickDirectory).mockResolvedValueOnce(project.path);
    vi.mocked(service.openProject).mockResolvedValue(project);

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(await screen.findByRole("button", { name: "打开项目" }));

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

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await user.click(
      await screen.findByRole("button", {
        name: "重新定位项目 Missing Archive",
      }),
    );

    expect(service.relocateProject).toHaveBeenCalledWith(
      toRecord(missingProject),
      "D:\\restored\\missing",
    );
    expect(
      await screen.findByRole("button", { name: "打开项目 Missing Archive" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "将 Stale Archive 从最近项目中移除",
      }),
    );

    expect(service.removeRecord).toHaveBeenCalledWith("stale");
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "重新定位项目 Stale Archive" }),
      ).not.toBeInTheDocument();
    });
  });

  it("uses the same picker and service flow for a native open-project menu action", async () => {
    const project = makeProject();
    const { dependencies, emitMenuAction, pickDirectory, service } =
      createDependencies();
    vi.mocked(pickDirectory).mockResolvedValueOnce(project.path);
    vi.mocked(service.openProject).mockResolvedValue(project);

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await screen.findByRole("button", { name: "新建项目" });

    await act(async () => {
      emitMenuAction("open-project");
    });

    await waitFor(() => {
      expect(service.openProject).toHaveBeenCalledWith(project.path);
    });
    expect(await screen.findByText("Editorial")).toBeVisible();
  });

  it("reports a failing native menu action without leaving an unhandled rejection", async () => {
    const { dependencies, emitMenuAction, pickDirectory, service } =
      createDependencies();
    vi.mocked(pickDirectory).mockResolvedValueOnce("C:\\shoots\\Broken");
    vi.mocked(service.openProject).mockRejectedValueOnce(
      new Error("project vanished"),
    );

    const unhandledReasons: unknown[] = [];
    const captureUnhandled = (reason: unknown) => {
      unhandledReasons.push(reason);
    };
    process.on("unhandledRejection", captureUnhandled);

    try {
      renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

      await screen.findByRole("button", { name: "新建项目" });

      await act(async () => {
        emitMenuAction("open-project");
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "操作未能完成，请重试。",
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(unhandledReasons).toEqual([]);
    } finally {
      process.off("unhandledRejection", captureUnhandled);
    }
  });

  it("uses the same parent-first dialog flow for a native new-project menu action", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const { promise, resolve } = deferred<string | null>();
    const { dependencies, emitMenuAction, pickDirectory, service } =
      createDependencies();
    vi.mocked(pickDirectory).mockReturnValueOnce(promise);
    vi.mocked(service.createProject).mockResolvedValue(project);

    renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

    await screen.findByRole("button", { name: "新建项目" });

    await act(async () => {
      emitMenuAction("new-project");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      resolve("C:\\shoots");
    });

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("项目名称"), "Editorial");
    await user.click(
      within(dialog).getByRole("button", { name: "创建项目" }),
    );

    expect(service.createProject).toHaveBeenCalledWith("C:\\shoots", "Editorial");
    expect(await screen.findByText("Editorial")).toBeVisible();
  });

  it("cleans up the menu listener and ignores async completions after unmount", async () => {
    const { promise, resolve } = deferred<WorkspaceProjectView[]>();
    const { dependencies, emitMenuAction, native, pickDirectory, service, unlisten } =
      createDependencies();
    vi.mocked(service.loadProjects).mockReturnValueOnce(promise);

    const { unmount } = renderWithTheme(<WorkspaceProvider dependencies={dependencies} planDependencies={planDeps()} />);

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

