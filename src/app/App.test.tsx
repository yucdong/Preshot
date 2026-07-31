import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../domain/workspace/models";
import type {
  WorkspaceLogger,
  WorkspaceService,
} from "../domain/workspace/ports";
import type { PlanDependencies } from "../features/plan/ProjectPlanProvider";
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
      loadPlan: vi.fn().mockResolvedValue({ photographyPlan: "", referenceGroups: [] }),
      loadImage: vi.fn().mockResolvedValue(""),
      savePlan: vi.fn(),
      addGroup: vi.fn(),
      renameGroup: vi.fn(),
      setDescription: vi.fn(),
      setPhotographyPlan: vi.fn(),
      deleteGroup: vi.fn(),
      setColumns: vi.fn(),
      moveImage: vi.fn(),
      importImage: vi.fn(),
      removeImage: vi.fn(),
    },
    picker: { pickImageFile: vi.fn().mockResolvedValue(null) },
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
    },
    logger,
  };
}

describe("App", () => {
  it("auto-opens the most recently edited project and renders the project switcher", async () => {
    const project = makeProject();

    render(<App dependencies={createDependencies(project)} planDependencies={planDeps()} />);

    expect(await screen.findByRole("button", { name: "Add reference group" })).toBeVisible();

    const nav = screen.getByRole("navigation", { name: "Projects" });
    expect(
      within(nav).getByRole("button", { name: "Open project Editorial" }),
    ).toHaveAttribute("aria-current", "page");

    expect(screen.queryByText("Canvas")).not.toBeInTheDocument();
    expect(screen.queryByText("Copywriting")).not.toBeInTheDocument();
  });
});
