import { emptyOrganization } from "../domain/workspace/organization";
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
          schemaVersion: 17,
          title: "Demo",
          document: {
            format: "preshot-blocks",
            version: 5,
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
    loadProjectOrganization: vi.fn(async () => emptyOrganization()),
    updateProjectOrganization: vi.fn(),
    loadProjects: vi.fn().mockResolvedValue([project]),
    createProject: vi.fn(),
    openProject: vi.fn().mockResolvedValue(project),
    relocateProject: vi.fn(),
    removeRecord: vi.fn(),
    deleteProject: vi.fn(),
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
      getDefaultProjectsDirectory: vi.fn().mockResolvedValue("C:\\Users\\me\\.preshot\\projects"),
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
  it("cancels deletion without changes and keeps the editor open if its pending save fails", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const dependencies = createDependencies(project);
    const plans = planDeps();
    vi.mocked(plans.service.savePlan).mockRejectedValue(new Error("保存失败，请重试"));
    render(<App dependencies={dependencies} planDependencies={plans} />);
    const editor = await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    const showDialog = async () => {
      await user.click(screen.getByRole("button", { name: "更多项目操作 Editorial" }));
      await user.click(screen.getByRole("menuitem", { name: "删除项目" }));
      await user.click(screen.getByRole("button", { name: "从磁盘删除" }));
    };
    await showDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(plans.service.savePlan).not.toHaveBeenCalled();
    expect(editor).toBeVisible();
    await showDialog();
    await user.click(screen.getByRole("button", { name: "确认从磁盘删除" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("保存失败");
    expect(dependencies.service.deleteProject).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
    expect(editor).toBeVisible();
  });

  it.each(["list", "disk"] as const)("confirms %s removal, drains saves and closes the session without later writes", async (mode) => {
    const user = userEvent.setup();
    const project = makeProject();
    const dependencies = createDependencies(project);
    const plans = planDeps();
    const saved = deferred<void>();
    vi.mocked(plans.service.savePlan).mockReturnValue(saved.promise);
    vi.mocked(dependencies.service.removeRecord).mockResolvedValue([]);
    vi.mocked(dependencies.service.deleteProject).mockResolvedValue([]);
    render(<App dependencies={dependencies} planDependencies={plans} />);
    await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "更多项目操作 Editorial" }));
    await user.click(screen.getByRole("menuitem", { name: "删除项目" }));
    const dialog = screen.getByRole("dialog", { name: "删除项目" });
    expect(dialog).toHaveTextContent(project.path);
    expect(dependencies.service.deleteProject).not.toHaveBeenCalled();
    if (mode === "disk") {
      await user.click(within(dialog).getByRole("button", { name: "从磁盘删除" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("其他所有文件");
      expect(dependencies.service.deleteProject).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "确认从磁盘删除" }));
    } else {
      await user.click(within(dialog).getByRole("button", { name: "从列表移除" }));
    }
    await waitFor(() => expect(plans.service.savePlan).toHaveBeenCalled());
    expect(dependencies.service.removeRecord).not.toHaveBeenCalled();
    expect(dependencies.service.deleteProject).not.toHaveBeenCalled();
    await act(async () => saved.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
    expect(dependencies.service[mode === "disk" ? "deleteProject" : "removeRecord"])
      .toHaveBeenCalledWith(mode === "disk" ? project : project.projectId);
    expect(dependencies.service[mode === "disk" ? "removeRecord" : "deleteProject"]).not.toHaveBeenCalled();
    expect(plans.service.savePlan).toHaveBeenCalledTimes(1);
    if (mode === "disk") expect(plans.service.purgeDetachedGroups).not.toHaveBeenCalled();
  });

  it("keeps disk deletion errors in the dialog and allows retry without a second save", async () => {
    const user = userEvent.setup();
    const project = makeProject();
    const dependencies = createDependencies(project);
    vi.mocked(dependencies.service.deleteProject).mockRejectedValueOnce(new Error("文件被占用，请关闭后重试")).mockResolvedValue([]);
    const plans = planDeps();
    render(<App dependencies={dependencies} planDependencies={plans} />);
    await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "更多项目操作 Editorial" }));
    await user.click(screen.getByRole("menuitem", { name: "删除项目" }));
    await user.click(screen.getByRole("button", { name: "从磁盘删除" }));
    await user.click(screen.getByRole("button", { name: "确认从磁盘删除" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("文件被占用");
    expect(dependencies.service.removeRecord).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "确认从磁盘删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(dependencies.service.deleteProject).toHaveBeenCalledTimes(2);
    expect(plans.service.savePlan).toHaveBeenCalledTimes(1);
  });

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
      within(within(nav).getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 Editorial" }),
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
      within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 Preshot 入门示例" }),
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

    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 Editorial" }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(dependencies.service.openProject).not.toHaveBeenCalled();

    vi.mocked(plans.service.loadPlan).mockReturnValueOnce(loaded.promise);
    vi.mocked(plans.service.loadMedia).mockReturnValueOnce(media.promise);
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }));
    expect(screen.getByRole("progressbar", { name: "项目加载进度" })).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "项目" })).toHaveAttribute("inert");
    expect(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 Editorial" }))
      .toHaveAttribute("aria-current", "page");
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }));
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
    await waitFor(() => expect(plans.service.loadMedia).toHaveBeenCalledWith(second.path, "media/delayed.png", undefined));
    expect(screen.getByRole("progressbar")).toBeVisible();
    await act(async () => media.resolve("data:image/png;base64,AA"));
    await canvasReady();
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }))
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
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }));
    expect(screen.getByRole("progressbar")).toBeVisible();
    await act(async () => opened.reject(new Error("无法读取项目，请重试")));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
    expect(dependencies.logger.error).toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 Editorial" }))
      .toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }))
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
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }));
    expect(dependencies.service.openProject).not.toHaveBeenCalled();
    const result = await planDeps().service.loadPlan(first.path, first.name);
    await act(async () => oldLoad.resolve(result));
    await canvasReady();
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }));
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
        requiredSchemaVersion: 17,
      });
    }
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 夜景" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(status === "failed" ? "方案读取失败" : "方案版本不兼容");
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
    expect(screen.getByRole("button", { name: "重试加载" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "方案正文" })).not.toBeInTheDocument();
  });
});
