import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
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
  };
}

describe("AppShell", () => {
  it("renders the project switcher, highlights the current project, and renders children", () => {
    const projects = [
      makeProject({ projectId: "sunset", name: "Sunset Shanghai" }),
      makeProject({ projectId: "editorial", name: "Editorial" }),
    ];

    render(
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

  it("switches, creates, and opens projects through the sidebar controls", async () => {
    const user = userEvent.setup();
    const h = handlers();
    const projects = [
      makeProject({ projectId: "sunset", name: "Sunset Shanghai" }),
      makeProject({ projectId: "editorial", name: "Editorial" }),
    ];

    render(
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

  it("marks unavailable projects and surfaces a workspace error", () => {
    const projects = [
      makeProject({ projectId: "missing", name: "Missing Archive", status: "unavailable" }),
    ];

    render(
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
