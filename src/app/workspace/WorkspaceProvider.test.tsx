import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "../../shared/i18n/config";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsRepository } from "../../domain/settings/ports";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import type { PlanLoadProgress } from "../../features/plan/blocknote/planLoadProgress";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { WorkspaceDependencies } from "./dependencies";
import { WorkspaceProvider } from "./WorkspaceProvider";

const prepareCopy = vi.hoisted(() => vi.fn(async () => vi.fn()));

vi.mock("../layout/Workspace", () => ({
  Workspace: function Workspace({
    active = true,
    projectName,
    projectPath,
    loadId,
    onLoadProgress,
    registerBeforeCopy,
  }: {
    active?: boolean;
    projectName: string;
    projectPath: string;
    loadId: number;
    onLoadProgress?(id: number, path: string, progress: PlanLoadProgress): void;
    registerBeforeCopy?(path: string, prepare: () => Promise<() => void>): () => void;
  }) {
    const [draft, setDraft] = useState("");
    useEffect(() => registerBeforeCopy?.(projectPath, prepareCopy), [projectPath, registerBeforeCopy]);
    useEffect(() => {
      onLoadProgress?.(loadId, projectPath, { status: "ready" });
    }, [loadId, onLoadProgress, projectPath]);
    return <div hidden={!active}>{`${projectName}|${projectPath}`}<input aria-label={`${projectName} 草稿`} value={draft} onChange={(event) => setDraft(event.target.value)} /></div>;
  },
}));

describe("WorkspaceProvider startup", () => {
  it("reports a failed project-folder reveal without an unhandled rejection and permits retry", async () => {
    const source: WorkspaceProjectView = {
      projectId: "source", path: "C:\\source", name: "原项目", status: "available", coverImage: null, coverDataUrl: null,
      createdAt: "2026-09-01", updatedAt: "2026-09-01", lastOpenedAt: "2026-09-01",
    };
    const reveal = vi.fn().mockRejectedValueOnce(new Error("项目目录已移动，请重新定位"))
      .mockResolvedValueOnce(undefined);
    const dependencies: WorkspaceDependencies = {
      service: {
        loadProjects: vi.fn().mockResolvedValue([source]), openProject: vi.fn(),
        createProject: vi.fn(), relocateProject: vi.fn(), removeRecord: vi.fn(), deleteProject: vi.fn(),
      },
      directoryPicker: { getDefaultProjectsDirectory: vi.fn(), pickDirectory: vi.fn() },
      native: { onMenuAction: vi.fn().mockResolvedValue(vi.fn()), maximizeWindow: vi.fn().mockResolvedValue(undefined) },
      projectDirectoryRevealer: { revealProjectDirectory: reveal },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    render(<ThemeProvider repository={{ read: async () => ({ theme: "light" }), write: async () => {} }}>
      <WorkspaceProvider dependencies={dependencies} planDependencies={{} as PlanDependencies} />
    </ThemeProvider>);
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "原项目 草稿" });
    await user.click(screen.getByRole("button", { name: "更多项目操作 原项目" }));
    await user.click(screen.getByRole("menuitem", { name: "打开项目目录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("项目目录已移动，请重新定位");
    await user.click(screen.getByRole("button", { name: "更多项目操作 原项目" }));
    await user.click(screen.getByRole("menuitem", { name: "打开项目目录" }));
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "原项目 草稿" })).toBeVisible();
  });

  it.each(["copying", "finishing", "completed"])("does not re-save the source while resuming a %s operation", async phase => {
    prepareCopy.mockClear();
    const source: WorkspaceProjectView = { projectId: "source", path: "C:\\source", name: "原项目", status: "available", coverImage: null, coverDataUrl: null,
      createdAt: "2026-09-01", updatedAt: "2026-09-01", lastOpenedAt: "2026-09-01" };
    const copied = { ...source, projectId: "copy", path: "C:\\copy", name: "副本" };
    const dependencies: WorkspaceDependencies = {
      service: {
        loadProjects: vi.fn().mockResolvedValue([source]), openProject: vi.fn().mockResolvedValue(source),
        createProject: vi.fn(), relocateProject: vi.fn(), removeRecord: vi.fn(), deleteProject: vi.fn(),
        suggestProjectCopy: vi.fn().mockResolvedValue({ parentPath: "C:\\", name: "副本" }),
        projectCopyStatus: vi.fn().mockResolvedValue({ operationId: "operation", phase, copiedBytes: 1, totalBytes: 2, project: null, error: null }),
        copyProject: vi.fn().mockResolvedValue(copied),
      },
      directoryPicker: { getDefaultProjectsDirectory: vi.fn(), pickDirectory: vi.fn() },
      native: { onMenuAction: vi.fn().mockResolvedValue(vi.fn()), maximizeWindow: vi.fn().mockResolvedValue(undefined) },
      projectDirectoryRevealer: { revealProjectDirectory: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    render(<ThemeProvider repository={{ read: async () => ({ theme: "light" }), write: async () => {} }}>
      <WorkspaceProvider dependencies={dependencies} planDependencies={{} as PlanDependencies} />
    </ThemeProvider>);
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "原项目 草稿" });
    await user.click(screen.getByRole("button", { name: "更多项目操作 原项目" }));
    await user.click(screen.getByRole("menuitem", { name: "复制项目" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "复制项目" }));
    await screen.findByRole("textbox", { name: "副本 草稿" });
    expect(prepareCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "关闭项目 原项目" })).toBeVisible();
  });
  it("retains open editors across switching and creation cancellation, and closes only the selected session", async () => {
    const user = userEvent.setup();
    const first: WorkspaceProjectView = {
      projectId: "first", path: "C:\\first", name: "项目一", status: "available",
      coverImage: null, coverDataUrl: null, createdAt: "2026-09-01", updatedAt: "2026-09-02", lastOpenedAt: "2026-09-02",
    };
    const second = { ...first, projectId: "second", path: "C:\\second", name: "项目二", updatedAt: "2026-09-01" };
    const dependencies: WorkspaceDependencies = {
      service: {
        loadProjects: vi.fn().mockResolvedValue([first, second]),
        openProject: vi.fn().mockImplementation(async (path) => path === second.path ? second : first),
        createProject: vi.fn(), relocateProject: vi.fn(), removeRecord: vi.fn(), deleteProject: vi.fn(),
      },
      directoryPicker: {
      getDefaultProjectsDirectory: vi.fn().mockResolvedValue("C:\\Users\\me\\.preshot\\projects"), pickDirectory: vi.fn().mockResolvedValue("C:\\projects") },
      native: { onMenuAction: vi.fn().mockResolvedValue(vi.fn()), maximizeWindow: vi.fn().mockResolvedValue(undefined) },
      projectDirectoryRevealer: { revealProjectDirectory: vi.fn() },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    render(<ThemeProvider repository={{ read: async () => ({ theme: "light" }), write: async () => {} }}>
      <WorkspaceProvider dependencies={dependencies} planDependencies={{} as PlanDependencies} />
    </ThemeProvider>);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "项目一 草稿" })).toBeVisible());
    const firstEditor = screen.getByRole("textbox", { name: "项目一 草稿" });
    fireEvent.change(firstEditor, { target: { value: "未丢失的编辑" } });
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 项目二" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "项目二 草稿" })).toBeVisible());
    await user.click(within(screen.getByRole("region", { name: "打开项目" })).getByRole("button", { name: "打开项目 项目一" }));
    expect(screen.getByRole("textbox", { name: "项目一 草稿" })).toBe(firstEditor);
    expect(firstEditor).toHaveValue("未丢失的编辑");
    expect(screen.queryByRole("region", { name: "项目加载" })).not.toBeInTheDocument();
    expect(dependencies.service.openProject).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("项目所在路径")).toHaveValue("C:\\Users\\me\\.preshot\\projects");
    expect(dependencies.directoryPicker.pickDirectory).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("textbox", { name: "项目一 草稿" })).toBe(firstEditor);
    expect(firstEditor).toHaveValue("未丢失的编辑");
    expect(screen.queryByRole("region", { name: "项目加载" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭项目 项目二" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "保存并关闭" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "打开项目" })).queryByRole("button", { name: "打开项目 项目二" })).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 项目二" })).toBeVisible();
    await user.click(within(screen.getByRole("region", { name: "所有项目" })).getByRole("button", { name: "打开项目 项目二" }));
    await waitFor(() => expect(dependencies.service.openProject).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "项目二 草稿" })).toBeVisible());
    await user.click(screen.getByRole("button", { name: "关闭项目 项目二" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "保存并关闭" }));
    await waitFor(() => expect(firstEditor).toBeVisible());
    await user.click(screen.getByRole("button", { name: "关闭项目 项目一" }));
    const confirmation = await screen.findByRole("dialog");
    expect(confirmation).toHaveTextContent("项目一");
    await user.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(firstEditor).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭项目 项目一" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "不保存并关闭" }));
    await waitFor(() => expect(firstEditor).not.toBeInTheDocument());
    expect(dependencies.service.removeRecord).not.toHaveBeenCalled();
  });
  it("auto-opens the starter returned by the bootstrapping workspace service", async () => {
    const starter: WorkspaceProjectView = {
      projectId: "starter",
      path: "C:\\Users\\me\\.preshot\\projects\\Preshot 入门示例",
      name: "Preshot 入门示例",
      coverImage: null,
      coverDataUrl: null,
      status: "available",
      createdAt: "2026-08-19T15:04:03.669Z",
      updatedAt: "2026-08-19T15:04:03.669Z",
      lastOpenedAt: "2026-08-19T15:04:03.669Z",
    };
    const maximizeWindow = vi.fn().mockResolvedValue(undefined);
    const dependencies: WorkspaceDependencies = {
      service: {
        loadProjects: vi.fn().mockResolvedValue([starter]),
        createProject: vi.fn(),
        openProject: vi.fn().mockResolvedValue(starter),
        relocateProject: vi.fn(),
        removeRecord: vi.fn(),
        deleteProject: vi.fn(),
      },
      directoryPicker: {
      getDefaultProjectsDirectory: vi.fn().mockResolvedValue("C:\\Users\\me\\.preshot\\projects"), pickDirectory: vi.fn().mockResolvedValue(null) },
      native: {
        onMenuAction: vi.fn().mockResolvedValue(vi.fn()),
        maximizeWindow,
      },
      projectDirectoryRevealer: { revealProjectDirectory: vi.fn() },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };

    const settings: SettingsRepository = {
      read: vi.fn().mockResolvedValue({ theme: "light" }),
      write: vi.fn().mockResolvedValue(undefined),
    };

    render(
        <ThemeProvider repository={settings}>
          <WorkspaceProvider
            dependencies={dependencies}
            planDependencies={{} as PlanDependencies}
          />
        </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText(
      "Preshot 入门示例|C:\\Users\\me\\.preshot\\projects\\Preshot 入门示例",
    )).toBeVisible(), { timeout: 5000 });
    expect(maximizeWindow).toHaveBeenCalledTimes(1);
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(dependencies.service.loadProjects).toHaveBeenCalledTimes(1);
    expect(maximizeWindow).toHaveBeenCalledTimes(1);
  });
});
