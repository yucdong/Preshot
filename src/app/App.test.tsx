import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../domain/workspace/models";
import type {
  WorkspaceLogger,
  WorkspaceService,
} from "../domain/workspace/ports";
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
  it("renders through injected workspace dependencies without invoking Tauri APIs", async () => {
    const user = userEvent.setup();
    const project = makeProject();

    render(<App dependencies={createDependencies(project)} />);

    await user.click(
      await screen.findByRole("button", { name: "Open project Editorial" }),
    );

    expect(await screen.findByText("Editorial")).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Planning tools" }),
    ).toBeVisible();
    expect(screen.getByText("Start your photography plan")).toBeVisible();
    expect(screen.getByText("Canvas")).toBeVisible();
    expect(screen.getByText("Assets")).toBeVisible();
    expect(screen.getByText("Copywriting")).toBeVisible();
    expect(screen.getByText("Export")).toBeVisible();
  });
});
