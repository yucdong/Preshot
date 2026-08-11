import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import type { SettingsRepository } from "../../domain/settings/ports";
import { ThemeProvider } from "../theme/ThemeProvider";
import { AppShell } from "./AppShell";

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

function handlers() {
  return {
    onSelectProject: vi.fn(),
    onNewProject: vi.fn(),
    onOpenProject: vi.fn(),
    onRevealProject: vi.fn(),
    onRemoveProject: vi.fn(),
  };
}

const fakeRepository: SettingsRepository = {
  read: async () => ({ theme: "system" }),
  write: async () => {},
};

function renderShell(ui: ReactElement) {
  return render(<ThemeProvider repository={fakeRepository}>{ui}</ThemeProvider>);
}

describe("AppShell", () => {
  it("renders the project switcher, highlights the current project, and renders children", () => {
    const projects = [
      makeProject({ projectId: "sunset", name: "Sunset Shanghai" }),
      makeProject({ projectId: "editorial", name: "Editorial" }),
    ];

    renderShell(
      <AppShell currentProjectId="editorial" projects={projects} {...handlers()}>
        <p>Plan content</p>
      </AppShell>,
    );

    const nav = screen.getByRole("navigation", { name: "项目" });
    expect(within(nav).getByRole("button", { name: "打开项目 Sunset Shanghai" })).toBeVisible();

    const current = within(nav).getByRole("button", { name: "打开项目 Editorial" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Plan content")).toBeVisible();
  });

  it("renders the global settings button in the header", () => {
    renderShell(
      <AppShell currentProjectId="editorial" projects={[makeProject()]} {...handlers()}>
        <p>Plan content</p>
      </AppShell>,
    );

    const header = screen.getByRole("heading", { name: "PRESHOT" }).closest("header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("button", { name: "设置" })).toBeVisible();
  });

  it("renders accessible resizable panel separators", () => {
    renderShell(
      <AppShell currentProjectId="editorial" projects={[makeProject()]} {...handlers()}>
        <p>Plan content</p>
      </AppShell>,
    );

    expect(screen.getByRole("separator", { name: "调整项目栏宽度" })).toHaveAttribute(
      "aria-valuemin",
      "176",
    );
    expect(screen.getByRole("separator", { name: "调整助手栏宽度" })).toHaveAttribute(
      "aria-valuemax",
      "420",
    );
  });

  it("switches, creates, and opens projects through the sidebar controls", async () => {
    const user = userEvent.setup();
    const h = handlers();
    const projects = [
      makeProject({ projectId: "sunset", name: "Sunset Shanghai" }),
      makeProject({ projectId: "editorial", name: "Editorial" }),
    ];

    renderShell(
      <AppShell currentProjectId="editorial" projects={projects} {...h}>
        <p>Plan content</p>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "打开项目 Sunset Shanghai" }));
    expect(h.onSelectProject).toHaveBeenCalledWith(projects[0]);

    await user.click(screen.getByRole("button", { name: "新建项目" }));
    expect(h.onNewProject).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "打开项目" }));
    expect(h.onOpenProject).toHaveBeenCalledTimes(1);
  });

  it("reveals a project directory and confirms registry-only removal", async () => {
    const user = userEvent.setup();
    const h = handlers();
    const project = makeProject({ name: "Editorial", path: "C:\\shoots\\Editorial" });
    renderShell(
      <AppShell currentProjectId={project.projectId} projects={[project]} {...h}>
        <p>Plan content</p>
      </AppShell>,
    );

    expect(screen.getByTitle(project.path)).toHaveTextContent(project.path);
    await user.click(screen.getByRole("button", { name: "打开项目目录 Editorial" }));
    expect(h.onRevealProject).toHaveBeenCalledWith(project);

    await user.click(screen.getByRole("button", { name: "移除项目 Editorial" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("磁盘文件不会被删除");
    await user.click(screen.getByRole("button", { name: "从列表移除" }));
    expect(h.onRemoveProject).toHaveBeenCalledWith(project);
  });

  it("marks unavailable projects and surfaces a workspace error", () => {
    const projects = [
      makeProject({ projectId: "missing", name: "Missing Archive", status: "unavailable" }),
    ];

    renderShell(
      <AppShell
        currentProjectId="missing"
        error="Unable to open workspace project"
        projects={projects}
        {...handlers()}
      >
        <p>Plan content</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("button", { name: "Missing Archive（不可用）" }),
    ).toBeVisible();
    expect(screen.getByText("不可用")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("操作未能完成，请重试。");
  });
});
