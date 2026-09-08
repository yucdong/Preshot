import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../domain/workspace/models";
import type {
  WorkspaceLogger,
  WorkspaceService,
} from "../domain/workspace/ports";
import type { PlanDependencies } from "../features/plan/blocknote/dependencies";
import { App } from "./App";
import type { WorkspaceDependencies } from "./workspace/dependencies";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
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

function planDeps(): PlanDependencies {
  return {
    service: {
      loadPlan: vi.fn().mockResolvedValue({
        status: "missing",
        plan: {
          schemaVersion: 15,
          title: "Demo",
          document: {
            format: "preshot-blocks",
            version: 3,
            blocks: [{
              id: "block",
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
          },
          imageGroups: [],
          artifacts: [],
        },
      }),
      loadImage: vi.fn().mockResolvedValue(""),
      importMedia: vi.fn(),
      loadMedia: vi.fn(),
      savePlan: vi.fn(),
      importImages: vi.fn(),
      commitImageCrop: vi.fn(),
      removeImage: vi.fn(),
      removeGroup: vi.fn(),
      purgeDetachedGroups: vi.fn(),
      purgeDetachedMedia: vi.fn(),
    },
    picker: {
      pickImageFile: vi.fn().mockResolvedValue(null),
      pickImageFiles: vi.fn().mockResolvedValue([]),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    exporter: { implementation: "react-pdf", export: vi.fn() },
    docxExporter: { implementation: "blocknote-docx", export: vi.fn() },
    longImageExporter: { export: vi.fn() },
    saver: { save: vi.fn() },
    docxSaver: { save: vi.fn() },
    longImageSaver: { save: vi.fn() },
  };
}

function createDependencies(project: WorkspaceProjectView): WorkspaceDependencies {
  const service: WorkspaceService = {
    loadProjects: vi.fn().mockResolvedValue([project]),
    createProject: vi.fn(),
    openProject: vi.fn().mockResolvedValue(project),
    relocateProject: vi.fn(),
    removeRecord: vi.fn(),
  };
  const maximizeWindow = vi.fn().mockResolvedValue(undefined);
  const logger: WorkspaceLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    service,
    directoryPicker: {
      pickDirectory: vi.fn().mockResolvedValue(null),
    },
    native: {
      onMenuAction: vi.fn().mockResolvedValue(vi.fn()),
      maximizeWindow,
    },
    projectDirectoryRevealer: {
      revealProjectDirectory: vi.fn(),
    },
    logger,
  };
}

async function canvasReady() {
  return screen.findByRole("group", { name: "方案正文" }, { timeout: 5000 });
}

describe("App", () => {
  it("auto-opens the most recently edited project and renders the project switcher", async () => {
    const project = makeProject();
    const dependencies = createDependencies(project);

    render(<App dependencies={dependencies} planDependencies={planDeps()} />);

    expect(await canvasReady()).toBeVisible();
    expect(screen.queryByText(/BlockNote/)).not.toBeInTheDocument();
    expect(dependencies.native.maximizeWindow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("group", { name: "方案正文" })).toHaveAttribute(
      "data-editor-engine",
      "blocknote",
    );

    const nav = screen.getByRole("navigation", { name: "项目" });
    expect(
      within(nav).getByRole("button", { name: "打开项目 Editorial" }),
    ).toHaveAttribute("aria-current", "page");

    expect(screen.queryByText("Canvas")).not.toBeInTheDocument();
    expect(screen.queryByText("Copywriting")).not.toBeInTheDocument();
  });

  it("auto-opens a first-run starter returned by workspace startup", async () => {
    const starter = makeProject({
      projectId: "starter",
      path: "C:\\Users\\me\\.preshot\\projects\\Preshot 入门示例",
      name: "Preshot 入门示例",
      updatedAt: "2026-08-19T15:04:03.669Z",
      lastOpenedAt: "2026-08-19T15:04:03.669Z",
    });
    const dependencies = createDependencies(starter);

    render(<App dependencies={dependencies} planDependencies={planDeps()} />);

    expect(await canvasReady()).toBeVisible();
    expect(
      screen.getByRole("button", { name: "打开项目 Preshot 入门示例" }),
    ).toHaveAttribute("aria-current", "page");
    expect(dependencies.native.maximizeWindow).toHaveBeenCalledTimes(1);
  });

  it("keeps switch progress through project opening, document loading and asset loading", async () => {
    const user = userEvent.setup();
    const first = makeProject();
    const second = makeProject({
      projectId: "night",
      name: "夜景",
      path: "C:\\shoots\\Night",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const dependencies = createDependencies(first);
    vi.mocked(dependencies.service.loadProjects).mockResolvedValue([first, second]);
    const plans = planDeps();
    const opened = deferred<WorkspaceProjectView>();
    const loaded = deferred<Awaited<ReturnType<typeof plans.service.loadPlan>>>();
    const media = deferred<string>();
    vi.mocked(dependencies.service.openProject).mockReturnValue(opened.promise);
    render(<App dependencies={dependencies} planDependencies={plans} />);
    await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "打开项目 Editorial" }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(dependencies.service.openProject).not.toHaveBeenCalled();

    vi.mocked(plans.service.loadPlan).mockReturnValueOnce(loaded.promise);
    vi.mocked(plans.service.loadMedia).mockReturnValueOnce(media.promise);
    await user.click(screen.getByRole("button", { name: "打开项目 夜景" }));
    expect(screen.getByRole("progressbar", { name: "项目加载进度" })).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "项目" })).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "打开项目 Editorial" }))
      .toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "打开项目 夜景" }));
    expect(dependencies.service.openProject).toHaveBeenCalledTimes(1);

    await act(async () => opened.resolve(second));
    await waitFor(() => expect(plans.service.loadPlan).toHaveBeenCalledWith(second.path, second.name));
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.queryByText(/BlockNote/)).not.toBeInTheDocument();

    const result = await planDeps().service.loadPlan(second.path, second.name);
    if (result.status === "incompatible") throw new Error("Expected a loaded fixture");
    result.plan.document.blocks.push({
      id: "image",
      type: "image",
      props: { url: "media/delayed.png" },
      content: undefined,
      children: [],
    });
    await act(async () => loaded.resolve(result));
    await waitFor(() => expect(plans.service.loadMedia).toHaveBeenCalledWith(second.path, "media/delayed.png"));
    expect(screen.getByRole("progressbar")).toBeVisible();
    await act(async () => media.resolve("data:image/png;base64,AA"));
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"), { timeout: 4000 });
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
    await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "打开项目 夜景" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("stops progress after opening fails and permits retry", async () => {
    const user = userEvent.setup();
    const first = makeProject();
    const second = makeProject({ projectId: "night", name: "夜景", path: "C:\\shoots\\Night" });
    const dependencies = createDependencies(first);
    vi.mocked(dependencies.service.loadProjects).mockResolvedValue([first, second]);
    const opened = deferred<WorkspaceProjectView>();
    vi.mocked(dependencies.service.openProject).mockReturnValueOnce(opened.promise)
      .mockResolvedValue(second);
    render(<App dependencies={dependencies} planDependencies={planDeps()} />);
    await canvasReady();
    await user.click(screen.getByRole("button", { name: "打开项目 夜景" }));
    expect(screen.getByRole("progressbar")).toBeVisible();
    await act(async () => opened.reject(new Error("无法读取项目，请重试")));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
    expect(dependencies.logger.error).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "打开项目 Editorial" }))
      .toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "打开项目 夜景" }))
      .toHaveAttribute("aria-current", "page"));
    await canvasReady();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("blocks another switch until the current page has finished loading", async () => {
    const user = userEvent.setup();
    const first = makeProject();
    const second = makeProject({ projectId: "night", name: "夜景", path: "C:\\shoots\\Night" });
    const dependencies = createDependencies(first);
    vi.mocked(dependencies.service.loadProjects).mockResolvedValue([first, second]);
    vi.mocked(dependencies.service.openProject).mockResolvedValue(second);
    const plans = planDeps();
    const oldLoad = deferred<Awaited<ReturnType<typeof plans.service.loadPlan>>>();
    const newLoad = deferred<Awaited<ReturnType<typeof plans.service.loadPlan>>>();
    vi.mocked(plans.service.loadPlan).mockReturnValueOnce(oldLoad.promise)
      .mockReturnValueOnce(newLoad.promise);
    render(<App dependencies={dependencies} planDependencies={plans} />);
    await waitFor(() => expect(plans.service.loadPlan).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "打开项目 夜景" }));
    expect(dependencies.service.openProject).not.toHaveBeenCalled();
    const result = await planDeps().service.loadPlan(first.path, first.name);
    await act(async () => oldLoad.resolve(result));
    await canvasReady();
    await user.click(screen.getByRole("button", { name: "打开项目 夜景" }));
    await waitFor(() => expect(plans.service.loadPlan).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("progressbar")).toBeVisible();
    await act(async () => newLoad.resolve(result));
    await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  });

  it.each(["failed", "incompatible"] as const)("stops progress when the destination plan is %s", async (status) => {
    const user = userEvent.setup();
    const first = makeProject();
    const second = makeProject({ projectId: "night", name: "夜景", path: "C:\\shoots\\Night" });
    const dependencies = createDependencies(first);
    vi.mocked(dependencies.service.loadProjects).mockResolvedValue([first, second]);
    vi.mocked(dependencies.service.openProject).mockResolvedValue(second);
    const plans = planDeps();
    render(<App dependencies={dependencies} planDependencies={plans} />);
    await canvasReady();
    if (status === "failed") {
      vi.mocked(plans.service.loadPlan).mockRejectedValueOnce(new Error("方案读取失败"));
    } else {
      vi.mocked(plans.service.loadPlan).mockResolvedValueOnce({
        status: "incompatible",
        foundSchemaVersion: 99,
        requiredSchemaVersion: 15,
      });
    }
    await user.click(screen.getByRole("button", { name: "打开项目 夜景" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(status === "failed" ? "方案读取失败" : "方案版本不兼容");
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
    expect(screen.getByRole("button", { name: "重试加载" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
  });
});
