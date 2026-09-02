import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import type { SettingsRepository } from "../../domain/settings/ports";
import { ThemeProvider } from "../theme/ThemeProvider";
import { AppShell } from "./AppShell";
import {
  AgentModelSettingsController,
  AgentSessionController,
  DEFAULT_AGENT_MODEL_CAPABILITIES,
  DEFAULT_AGENT_MODEL_SETTINGS,
} from "../../domain/agent";
import { AgentModelSettingsProvider } from "../../features/agent/AgentModelSettingsContext";
import { AgentProvider } from "../../features/agent/AgentProvider";
import { createBrowserAgentModelProbe } from "../../infrastructure/agent/browserAgentModelProbe";
import { FakeAgentRuntime } from "../../infrastructure/agent/fakeAgentRuntime";
import { createMemoryAgentMetadataStore } from "../../infrastructure/agent/memoryAgentMetadataStore";
import { createSettingsAgentModelStore } from "../../infrastructure/agent/settingsAgentModelStore";

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
  const modelController = new AgentModelSettingsController({
    store: createSettingsAgentModelStore(fakeRepository),
    probe: createBrowserAgentModelProbe(),
  });
  const agentController = new AgentSessionController({
    runtime: new FakeAgentRuntime(),
    metadata: createMemoryAgentMetadataStore(),
    workspace: {
      captureSnapshot: () => {
        throw new Error("Workspace is not active in this shell test");
      },
      issueAttachment: () => {
        throw new Error("Workspace is not active in this shell test");
      },
      revokeAttachment: vi.fn(),
      readTextBlocks: () => [],
      navigateToBlock: () => ({ status: "navigated" }),
      navigateToImage: () => ({ status: "navigated" }),
    },
    configuration: async () => ({
      settings: DEFAULT_AGENT_MODEL_SETTINGS,
      capabilities: DEFAULT_AGENT_MODEL_CAPABILITIES,
    }),
  });
  return render(
    <AgentModelSettingsProvider controller={modelController}>
      <ThemeProvider repository={fakeRepository}>
        <AgentProvider controller={agentController}>{ui}</AgentProvider>
      </ThemeProvider>
    </AgentModelSettingsProvider>,
  );
}

describe("AppShell", () => {
  it("keeps the assistant closed by default and opens it from the persistent toggle", async () => {
    const user = userEvent.setup();
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
    expect(screen.queryByRole("complementary", { name: "助手" }))
      .not.toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByText("Plan content")).toBeVisible();

    expect(within(nav).getByRole("button", { name: "打开项目 Sunset Shanghai" })).toBeVisible();

    const current = within(nav).getByRole("button", { name: "打开项目 Editorial" });
    expect(current).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "显示助手面板" }));
    expect(screen.getByRole("complementary", { name: "助手" })).toBeVisible();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByRole("separator", { name: "调整助手栏宽度" }))
      .toHaveAttribute("aria-valuemin", "240");
    expect(screen.getByRole("separator", { name: "调整助手栏宽度" }))
      .toHaveAttribute("aria-valuemax", "420");

    await user.click(screen.getByRole("button", { name: "进入专注模式" }));
    expect(screen.queryByRole("navigation", { name: "项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "助手" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开项目面板" })).toBeVisible();
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

  it("renders the project separator while the assistant starts closed", () => {
    renderShell(
      <AppShell currentProjectId="editorial" projects={[makeProject()]} {...handlers()}>
        <p>Plan content</p>
      </AppShell>,
    );

    expect(screen.getByRole("separator", { name: "调整项目栏宽度" })).toHaveAttribute(
      "aria-valuemin",
      "176",
    );
    expect(screen.queryByRole("separator", { name: "调整助手栏宽度" }))
      .not.toBeInTheDocument();
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

    expect(screen.queryByText(project.path)).not.toBeInTheDocument();
    expect(screen.queryByTitle(project.path)).not.toBeInTheDocument();
    const revealButton = screen.getByRole("button", { name: "打开项目目录 Editorial" });
    revealButton.focus();
    expect(revealButton).toHaveFocus();
    await user.keyboard("{Enter}");
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
