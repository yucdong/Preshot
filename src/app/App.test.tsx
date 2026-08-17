import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../domain/workspace/models";
import type {
  WorkspaceLogger,
  WorkspaceService,
} from "../domain/workspace/ports";
import type { PlanDependencies } from "../features/plan/blocknote/dependencies";
import { App } from "./App";
import type { WorkspaceDependencies } from "./workspace/dependencies";

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
          schemaVersion: 14,
          title: "Demo",
          document: {
            format: "preshot-blocks",
            version: 2,
            blocks: [{
              id: "block",
              type: "paragraph",
              props: {},
              content: [],
              children: [],
            }],
          },
          imageGroups: [],
        },
      }),
      loadImage: vi.fn().mockResolvedValue(""),
      importMedia: vi.fn(),
      loadMedia: vi.fn(),
      savePlan: vi.fn(),
      importImages: vi.fn(),
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
    exporter: { export: vi.fn() },
    saver: { save: vi.fn() },
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

describe("App", () => {
  it("auto-opens the most recently edited project and renders the project switcher", async () => {
    const project = makeProject();
    const dependencies = createDependencies(project);

    render(<App dependencies={dependencies} planDependencies={planDeps()} />);

    expect(await screen.findByText("BlockNote Canvas v14")).toBeVisible();
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
});
