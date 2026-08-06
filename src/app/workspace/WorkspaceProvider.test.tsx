import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import type {
  CanvasPlanLoadResult,
  CanvasPlanService,
} from "../../domain/plan/canvas/service";
import type { WorkspaceDependencies } from "./dependencies";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";

const renderedPlanTitles = vi.hoisted(() => [] as string[]);

// Minimal fake repository for tests
const fakeRepository: SettingsRepository = {
  read: async () => ({ theme: "system" }),
  write: async () => {},
};

vi.mock("../../features/plan/canvas/PlanCanvas", () => ({
  PlanCanvas: ({
    title,
    onAddImage,
    onCommitTitle,
    onRenameComponent,
    onMoveComponent,
    onRemoveComponent,
    onResize,
    onSetImageCrop,
  }: {
    title: string;
    onAddImage(id: string): void;
    onCommitTitle(title: string): unknown;
    onRenameComponent(id: string, name: string): unknown;
    onMoveComponent?(id: string, target: { kind: "new-row"; rowId: string; toRowIndex: number }): void;
    onRemoveComponent?(id: string): void;
    onResize?(id: string, params: { width: number }): void;
    onSetImageCrop?(componentId: string, imageId: string, crop: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): void;
  }) => {
    renderedPlanTitles.push(title);
    return (
      <div data-testid="plan-canvas" data-title={title}>
        Canvas Mock
        <button onClick={() => onAddImage("r1")} type="button">Test import image</button>
        <button onClick={() => onCommitTitle("Retired title")} type="button">Test title</button>
        <button onClick={() => onRenameComponent("p1", "Shot list")} type="button">Test name</button>
        <button
          onClick={() => onMoveComponent?.("p1", {
            kind: "new-row",
            rowId: "row-moved",
            toRowIndex: 1,
          })}
          type="button"
        >
          Test row
        </button>
        <button onClick={() => onRemoveComponent?.("r1")} type="button">Test remove reference</button>
        <button onClick={() => onResize?.("r1", { width: 0.5 })} type="button">Test width</button>
        <button
          onClick={() => onSetImageCrop?.("r1", "existing-image", {
            x: 0.1,
            y: 0.2,
            width: 0.7,
            height: 0.6,
          })}
          type="button"
        >
          Test crop
        </button>
      </div>
    );
  },
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

function clonePlan(plan: ProjectPlan): ProjectPlan {
  return JSON.parse(JSON.stringify(plan)) as ProjectPlan;
}

class SharedFifoCanvasService implements CanvasPlanService {
  readonly events: string[] = [];
  readonly loadRequests: string[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly plans: Map<string, ProjectPlan>,
    private readonly removal: ReturnType<typeof deferred<void>>,
  ) {}

  private enqueue<T>(operation: string, task: () => Promise<T> | T): Promise<T> {
    this.events.push(`${operation}:queued`);
    const run = this.queue.then(async () => {
      this.events.push(`${operation}:started`);
      return task();
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  loadPlan(projectPath: string, _projectName: string): Promise<CanvasPlanLoadResult> {
    this.loadRequests.push(projectPath);
    return this.enqueue(`load:${projectPath}`, () => {
      const plan = this.plans.get(projectPath);
      if (!plan) {
        throw new Error(`Missing test plan for ${projectPath}`);
      }
      return { status: "loaded", plan: clonePlan(plan) };
    });
  }

  savePlan(projectPath: string, plan: ProjectPlan): Promise<void> {
    return this.enqueue(`save:${projectPath}`, () => {
      this.plans.set(projectPath, clonePlan(plan));
    });
  }

  loadImage(): Promise<string> {
    return Promise.resolve("");
  }

  importImage(): never {
    throw new Error("Not used by this shared FIFO regression.");
  }

  importImages(): never {
    throw new Error("Not used by this shared FIFO regression.");
  }

  removeImage(): never {
    throw new Error("Not used by this shared FIFO regression.");
  }

  removeComponent(
    projectPath: string,
    plan: ProjectPlan,
    componentId: string,
  ): Promise<ProjectPlan> {
    return this.enqueue(`remove:${projectPath}`, async () => {
      await this.removal.promise;
      const persisted = {
        ...plan,
        components: plan.components.filter((component) => component.id !== componentId),
      };
      this.plans.set(projectPath, clonePlan(persisted));
      return persisted;
    });
  }

  async waitForIdle(): Promise<void> {
    await this.queue;
  }

  planAt(projectPath: string): ProjectPlan {
    const plan = this.plans.get(projectPath);
    if (!plan) {
      throw new Error(`Missing test plan for ${projectPath}`);
    }
    return clonePlan(plan);
  }
}

function planDeps(): CanvasPlanDependencies {
  return {
    service: {
      loadPlan: vi.fn().mockResolvedValue({
        status: "loaded",
        plan: { schemaVersion: 5, title: "Demo", components: [] },
      }),
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

  it("flushes a retiring project's deferred image delta and concurrent v5 edits before switching", async () => {
    const user = userEvent.setup();
    const retiringProject = makeProject({
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    const nextProject = makeProject({
      projectId: "next",
      name: "Next project",
      path: "C:\\shoots\\Next",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    const retiringPlan = {
      schemaVersion: 5 as const,
      title: "Original title",
      components: [
        {
          id: "p1",
          rowId: "row-shared",
          name: "文案1",
          type: "plan" as const,
          width: 0.4,
          html: "",
        },
        {
          id: "r1",
          rowId: "row-shared",
          name: "图片组1",
          type: "reference" as const,
          width: 0.4,
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [
            {
              id: "existing-image",
              file: "references/existing.png",
              aspectRatio: 1,
            },
          ],
        },
      ],
    };
    const nextPlan = {
      schemaVersion: 5 as const,
      title: "Next title",
      components: [],
    };
    const importedImage = {
      id: "imported-image",
      file: "references/imported.png",
      aspectRatio: 1,
    };
    const importedPlan: ProjectPlan = {
      ...retiringPlan,
      components: retiringPlan.components.map((component) =>
        component.id === "r1" && component.type === "reference"
          ? { ...component, images: [...component.images, importedImage] }
          : component,
      ),
    };
    const imported = deferred<{
      plan: ProjectPlan;
      image: { id: string; file: string; aspectRatio: number };
      dataUrl: string;
    }>();
    const { dependencies, service } = createDependencies();
    const canvasDependencies = planDeps();
    vi.mocked(service.loadProjects).mockResolvedValue([nextProject, retiringProject]);
    vi.mocked(service.openProject).mockResolvedValue(nextProject);
    vi.mocked(canvasDependencies.service.loadPlan)
      .mockResolvedValueOnce({ status: "loaded", plan: retiringPlan })
      .mockResolvedValueOnce({ status: "loaded", plan: nextPlan });
    vi.mocked(canvasDependencies.picker.pickImageFile).mockResolvedValue("C:\\source\\new.png");
    vi.mocked(canvasDependencies.service.importImage).mockReturnValue(imported.promise);

    renderWithTheme(
      <WorkspaceProvider dependencies={dependencies} planDependencies={canvasDependencies} />,
    );

    await screen.findByTestId("plan-canvas");
    await user.click(screen.getByRole("button", { name: "Test import image" }));
    await waitFor(() => {
      expect(canvasDependencies.service.importImage).toHaveBeenCalledWith(
        retiringProject.path,
        retiringPlan,
        "r1",
        "C:\\source\\new.png",
      );
    });

    await user.click(screen.getByRole("button", { name: "Test title" }));
    await user.click(screen.getByRole("button", { name: "Test name" }));
    await user.click(screen.getByRole("button", { name: "Test row" }));
    await user.click(screen.getByRole("button", { name: "Test width" }));
    await user.click(screen.getByRole("button", { name: "Test crop" }));
    await user.click(screen.getByRole("button", { name: "打开项目 Next project" }));
    await screen.findByRole("button", { name: "打开项目 Next project" });

    await act(async () => {
      imported.resolve({
        plan: importedPlan,
        image: importedImage,
        dataUrl: "data:image/png;base64,AA==",
      });
    });

    await waitFor(() => {
      expect(canvasDependencies.service.savePlan).toHaveBeenCalledWith(
        retiringProject.path,
        expect.objectContaining({
          title: "Retired title",
          components: expect.arrayContaining([
            expect.objectContaining({
              id: "p1",
              rowId: "row-moved",
              name: "Shot list",
            }),
            expect.objectContaining({
              id: "r1",
              width: 0.5,
              images: expect.arrayContaining([
                expect.objectContaining({
                  id: "existing-image",
                  crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
                }),
                expect.objectContaining({
                  id: "imported-image",
                  file: "references/imported.png",
                }),
              ]),
            }),
          ]),
        }),
      );
    });
    expect(canvasDependencies.service.savePlan).not.toHaveBeenCalledWith(
      nextProject.path,
      expect.anything(),
    );
    expect(screen.getByTestId("plan-canvas")).toHaveAttribute("data-title", "Next title");
  });

  it("serializes rapid A-to-B-to-A loads behind a retiring destructive save on a shared FIFO", async () => {
    const user = userEvent.setup();
    const projectA = makeProject({
      projectId: "a",
      name: "Project A",
      path: "C:\\shoots\\A",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    const projectB = makeProject({
      projectId: "b",
      name: "Project B",
      path: "C:\\shoots\\B",
      updatedAt: "2026-07-08T00:00:00.000Z",
    });
    const planA: ProjectPlan = {
      schemaVersion: 5,
      title: "Original A metadata",
      components: [
        {
          id: "p1",
          rowId: "row-p1",
          name: "Plan",
          type: "plan",
          width: 1,
          html: "",
        },
        {
          id: "r1",
          rowId: "row-r1",
          name: "Reference",
          type: "reference",
          width: 1,
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [],
        },
      ],
    };
    const planB: ProjectPlan = {
      schemaVersion: 5,
      title: "B metadata must never leak",
      components: [],
    };
    const removal = deferred<void>();
    const canvasService = new SharedFifoCanvasService(
      new Map([
        [projectA.path, planA],
        [projectB.path, planB],
      ]),
      removal,
    );
    const canvasDependencies = {
      ...planDeps(),
      service: canvasService,
    };
    const { dependencies, service } = createDependencies();
    vi.mocked(service.loadProjects).mockResolvedValue([projectB, projectA]);
    vi.mocked(service.openProject).mockImplementation(async (path) => {
      if (path === projectA.path) {
        return projectA;
      }
      if (path === projectB.path) {
        return projectB;
      }
      throw new Error(`Unexpected project path ${path}`);
    });
    renderedPlanTitles.length = 0;

    renderWithTheme(
      <WorkspaceProvider dependencies={dependencies} planDependencies={canvasDependencies} />,
    );

    expect(await screen.findByTestId("plan-canvas")).toHaveAttribute(
      "data-title",
      "Original A metadata",
    );
    await user.click(screen.getByRole("button", { name: "Test remove reference" }));
    await waitFor(() =>
      expect(canvasService.events).toContain(`remove:${projectA.path}:started`),
    );
    await user.click(screen.getByRole("button", { name: "Test title" }));

    await user.click(screen.getByRole("button", { name: "打开项目 Project B" }));
    await waitFor(() => expect(service.openProject).toHaveBeenCalledWith(projectB.path));
    await user.click(screen.getByRole("button", { name: "打开项目 Project A" }));
    await waitFor(() => expect(service.openProject).toHaveBeenCalledWith(projectA.path));

    expect(canvasService.loadRequests).toEqual([projectA.path]);

    await act(async () => {
      removal.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("plan-canvas")).toHaveAttribute(
        "data-title",
        "Retired title",
      ),
    );
    expect(renderedPlanTitles).not.toContain("B metadata must never leak");
    expect(canvasService.planAt(projectA.path)).toMatchObject({
      title: "Retired title",
      components: [expect.objectContaining({ id: "p1" })],
    });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await act(async () => {
      await canvasService.waitForIdle();
    });
    expect(canvasService.planAt(projectA.path)).toMatchObject({
      title: "Retired title",
      components: [expect.objectContaining({ id: "p1" })],
    });
    expect(canvasService.events.findIndex((event) => event === `save:${projectA.path}:started`)).toBeLessThan(
      canvasService.events.findIndex((event) => event === `load:${projectB.path}:started`),
    );
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
      "选择新建 Preshot 项目的父文件夹",
      { defaultToProjectsDir: true },
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
      "选择新建 Preshot 项目的父文件夹",
      { defaultToProjectsDir: true },
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
