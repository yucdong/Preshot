import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsRepository } from "../../domain/settings/ports";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import type { PlanLoadProgress } from "../../features/plan/blocknote/planLoadProgress";
import { ThemeProvider } from "../theme/ThemeProvider";
import type { WorkspaceDependencies } from "./dependencies";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { AgentModelSettingsController } from "../../domain/agent";
import { AgentModelSettingsProvider } from "../../features/agent/AgentModelSettingsContext";
import { createBrowserAgentModelProbe } from "../../infrastructure/agent/browserAgentModelProbe";
import { createSettingsAgentModelStore } from "../../infrastructure/agent/settingsAgentModelStore";

vi.mock("../layout/Workspace", () => ({
  Workspace: function Workspace({
    projectName,
    projectPath,
    loadId,
    onLoadProgress,
  }: {
    projectName: string;
    projectPath: string;
    loadId: number;
    onLoadProgress?(id: number, path: string, progress: PlanLoadProgress): void;
  }) {
    useEffect(() => {
      onLoadProgress?.(loadId, projectPath, { status: "ready" });
    }, [loadId, onLoadProgress, projectPath]);
    return <div>{`${projectName}|${projectPath}`}</div>;
  },
}));

describe("WorkspaceProvider startup", () => {
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
      },
      directoryPicker: { pickDirectory: vi.fn().mockResolvedValue(null) },
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

    const controller = new AgentModelSettingsController({
      store: createSettingsAgentModelStore(settings),
      probe: createBrowserAgentModelProbe(),
    });
    render(
      <AgentModelSettingsProvider controller={controller}>
        <ThemeProvider repository={settings}>
          <WorkspaceProvider
            dependencies={dependencies}
            planDependencies={{} as PlanDependencies}
          />
        </ThemeProvider>
      </AgentModelSettingsProvider>,
    );

    await waitFor(() => expect(screen.getByText(
      "Preshot 入门示例|C:\\Users\\me\\.preshot\\projects\\Preshot 入门示例",
    )).toBeVisible(), { timeout: 5000 });
    expect(maximizeWindow).toHaveBeenCalledTimes(1);
  });
});
