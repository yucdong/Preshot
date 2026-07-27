import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

type ProjectStatus = "available" | "unavailable";

interface ProjectFixture {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  coverDataUrl: string | null;
}

interface RenderOptions {
  projects?: ProjectFixture[];
  loading?: boolean;
  error?: string | null;
  onOpen?: (project: ProjectFixture) => Promise<void> | void;
  onCreate?: (name: string) => Promise<void> | void;
  onOpenExisting?: () => Promise<void> | void;
  onRelocate?: (project: ProjectFixture) => Promise<void> | void;
  onRemove?: (project: ProjectFixture) => Promise<void> | void;
}

const originalScrollBy = HTMLElement.prototype.scrollBy;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function makeProject(
  index: number,
  overrides: Partial<ProjectFixture> = {},
): ProjectFixture {
  return {
    id: `project-${index}`,
    name: `Project ${index}`,
    path: `C:\\Projects\\Project ${index}`,
    status: "available",
    coverDataUrl: null,
    ...overrides,
  };
}

function renderLauncher(options: RenderOptions = {}) {
  const onOpen = vi.fn(options.onOpen ?? (() => undefined));
  const onCreate = vi.fn(options.onCreate ?? (() => undefined));
  const onOpenExisting = vi.fn(options.onOpenExisting ?? (() => undefined));
  const onRelocate = vi.fn(options.onRelocate ?? (() => undefined));
  const onRemove = vi.fn(options.onRemove ?? (() => undefined));

  render(
    <WorkspaceLauncher
      error={options.error ?? null}
      loading={options.loading ?? false}
      onCreate={onCreate}
      onOpen={onOpen}
      onOpenExisting={onOpenExisting}
      onRelocate={onRelocate}
      onRemove={onRemove}
      projects={options.projects ?? []}
    />,
  );

  return { onOpen, onCreate, onOpenExisting, onRelocate, onRemove };
}

describe("WorkspaceLauncher", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: originalScrollBy,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it("shows an accessible loading state", () => {
    renderLauncher({ loading: true });

    expect(screen.getByRole("status")).toHaveTextContent("Loading recent projects");
  });

  it("shows empty-state actions and keeps them available with a recoverable error", async () => {
    const user = userEvent.setup();
    const { onOpenExisting } = renderLauncher({
      error: "Could not refresh recent projects.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh recent projects.",
    );

    await user.click(screen.getByRole("button", { name: "Open project" }));
    expect(onOpenExisting).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("renders all recent projects and the rail controls", async () => {
    const user = userEvent.setup();
    const projects = [
      makeProject(1, { name: "Editorial" }),
      makeProject(2, { name: "Portraits" }),
      makeProject(3, { name: "Landscapes" }),
      makeProject(4, { name: "Studio" }),
    ];
    const { onOpen } = renderLauncher({ projects });

    expect(screen.getByRole("heading", { name: "Preshot" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Open project / })).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Recent projects" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous projects" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next projects" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open project Studio" }));
    expect(onOpen).toHaveBeenCalledWith(projects[3]);
  });

  it("shows cover images and fallback artwork for available projects", () => {
    renderLauncher({
      projects: [
        makeProject(1, {
          name: "Editorial",
          coverDataUrl: "data:image/png;base64,ZmFrZS1pbWFnZQ==",
        }),
        makeProject(2, { name: "Monochrome" }),
      ],
    });

    expect(screen.getByAltText("Editorial cover")).toHaveAttribute(
      "src",
      "data:image/png;base64,ZmFrZS1pbWFnZQ==",
    );

    const fallbackCard = screen
      .getByRole("button", { name: "Open project Monochrome" })
      .closest("article");

    expect(fallbackCard).not.toBeNull();
    expect(within(fallbackCard!).queryByRole("img")).not.toBeInTheDocument();
    expect(fallbackCard?.querySelector('[style*="linear-gradient"]')).not.toBeNull();
  });

  it("shows unavailable project recovery actions and never offers open", async () => {
    const user = userEvent.setup();
    const unavailableProject = makeProject(7, {
      name: "Missing Archive",
      status: "unavailable",
    });
    const { onRelocate, onRemove } = renderLauncher({
      projects: [unavailableProject],
    });

    expect(screen.queryByRole("button", { name: "Open project Missing Archive" })).not.toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: "Relocate project Missing Archive",
      }),
    );
    expect(onRelocate).toHaveBeenCalledWith(unavailableProject);

    await user.click(
      screen.getByRole("button", {
        name: "Remove Missing Archive from recent projects",
      }),
    );
    expect(onRemove).toHaveBeenCalledWith(unavailableProject);
  });

  it("moves focus through the project rail with arrow keys and disables boundary controls", async () => {
    const user = userEvent.setup();
    const projects = [
      makeProject(1),
      makeProject(2),
      makeProject(3),
      makeProject(4),
      makeProject(5),
    ];
    renderLauncher({ projects });

    const rail = screen.getByRole("region", { name: "Recent projects" });
    const nextButton = screen.getByRole("button", { name: "Next projects" });
    const previousButton = screen.getByRole("button", { name: "Previous projects" });

    rail.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");

    expect(screen.getByRole("button", { name: "Open project Project 5" })).toHaveFocus();
    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number) }),
    );
    expect(nextButton).toBeDisabled();
    expect(previousButton).toBeEnabled();

    vi.mocked(HTMLElement.prototype.scrollBy).mockClear();

    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");

    expect(screen.getByRole("button", { name: "Open project Project 1" })).toHaveFocus();
    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number) }),
    );
    expect(previousButton).toBeDisabled();
  });

  it("translates mouse-wheel movement into horizontal scrolling", () => {
    renderLauncher({
      projects: [makeProject(1), makeProject(2), makeProject(3), makeProject(4)],
    });

    const rail = screen.getByRole("region", { name: "Recent projects" });
    fireEvent.wheel(rail, { deltaY: 120 });

    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: 120 }),
    );
  });

  it("opens the create dialog with form semantics, trims names, and resets after cancel or success", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderLauncher();

    await user.click(screen.getByRole("button", { name: "New project" }));

    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Project name");
    const createButton = within(dialog).getByRole("button", {
      name: "Create project",
    });

    expect(input).toHaveFocus();
    expect(createButton).toBeDisabled();

    await user.type(input, "  Editorial  {Enter}");

    expect(onCreate).toHaveBeenCalledWith("Editorial");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "New project" }));
    const reopenedDialog = screen.getByRole("dialog");
    const reopenedInput = within(reopenedDialog).getByLabelText("Project name");
    expect(reopenedInput).toHaveValue("");

    await user.type(reopenedInput, "Temporary");
    await user.click(within(reopenedDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByLabelText("Project name")).toHaveValue("");
  });

  it("closes the create dialog on Escape", async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the create dialog open with the trimmed value when creation fails", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderLauncher({
      onCreate: () => Promise.reject(new Error("retry")),
    });

    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Project name");

    await user.type(input, "  Retry me  ");
    await user.click(
      within(dialog).getByRole("button", { name: "Create project" }),
    );

    expect(onCreate).toHaveBeenCalledWith("Retry me");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("Project name")).toHaveValue("Retry me");
  });
});
