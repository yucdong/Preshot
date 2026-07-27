import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceProjectView } from "../../domain/workspace/models";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

interface RenderOptions {
  projects?: WorkspaceProjectView[];
  loading?: boolean;
  error?: string | null;
  isCreateDialogOpen?: boolean;
  onOpen?: (project: WorkspaceProjectView) => Promise<void> | void;
  onRequestCreate?: () => Promise<void> | void;
  onCancelCreate?: () => void;
  onCreate?: (name: string) => Promise<void> | void;
  onOpenExisting?: () => Promise<void> | void;
  onRelocate?: (project: WorkspaceProjectView) => Promise<void> | void;
  onRemove?: (project: WorkspaceProjectView) => Promise<void> | void;
}

const originalScrollBy = HTMLElement.prototype.scrollBy;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

interface RailLayoutFixture {
  cardWidth: number;
  gap: number;
  clientWidth: number;
  scrollWidth: number;
  scrollLeft?: number;
}

function makeProject(
  index: number,
  overrides: Partial<WorkspaceProjectView> = {},
): WorkspaceProjectView {
  return {
    projectId: `project-${index}`,
    path: `C:\\Projects\\Project ${index}`,
    name: `Project ${index}`,
    coverImage: null,
    coverDataUrl: null,
    status: "available",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    lastOpenedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

function renderLauncher(options: RenderOptions = {}) {
  const onOpen = vi.fn(options.onOpen ?? (() => undefined));
  const onRequestCreate = vi.fn(options.onRequestCreate ?? (() => undefined));
  const onCancelCreate = vi.fn(options.onCancelCreate ?? (() => undefined));
  const onCreate = vi.fn(options.onCreate ?? (() => undefined));
  const onOpenExisting = vi.fn(options.onOpenExisting ?? (() => undefined));
  const onRelocate = vi.fn(options.onRelocate ?? (() => undefined));
  const onRemove = vi.fn(options.onRemove ?? (() => undefined));

  function Harness() {
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(
      options.isCreateDialogOpen ?? false,
    );

    return (
      <WorkspaceLauncher
        error={options.error ?? null}
        isCreateDialogOpen={isCreateDialogOpen}
        loading={options.loading ?? false}
        onCancelCreate={() => {
          onCancelCreate();
          setIsCreateDialogOpen(false);
        }}
        onCreate={async (name) => {
          await onCreate(name);
          setIsCreateDialogOpen(false);
        }}
        onOpen={onOpen}
        onOpenExisting={onOpenExisting}
        onRelocate={onRelocate}
        onRemove={onRemove}
        onRequestCreate={async () => {
          await onRequestCreate();
          setIsCreateDialogOpen(true);
        }}
        projects={options.projects ?? []}
      />
    );
  }

  render(<Harness />);

  return {
    onOpen,
    onRequestCreate,
    onCancelCreate,
    onCreate,
    onOpenExisting,
    onRelocate,
    onRemove,
  };
}

function mockRailLayout(rail: HTMLElement, layout: RailLayoutFixture) {
  const firstCard = rail.firstElementChild as HTMLElement | null;

  if (!firstCard) {
    throw new Error("Expected the rail to render at least one project card.");
  }

  rail.style.columnGap = `${layout.gap}px`;
  rail.style.gap = `${layout.gap}px`;

  vi.spyOn(firstCard, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, layout.cardWidth, 240),
  );

  Object.defineProperty(rail, "clientWidth", {
    configurable: true,
    value: layout.clientWidth,
  });
  Object.defineProperty(rail, "scrollWidth", {
    configurable: true,
    value: layout.scrollWidth,
  });
  Object.defineProperty(rail, "scrollLeft", {
    configurable: true,
    value: layout.scrollLeft ?? 0,
    writable: true,
  });

  return {
    setClientWidth(value: number) {
      Object.defineProperty(rail, "clientWidth", {
        configurable: true,
        value,
      });
    },
    setScrollLeft(value: number) {
      rail.scrollLeft = value;
    },
    setScrollWidth(value: number) {
      Object.defineProperty(rail, "scrollWidth", {
        configurable: true,
        value,
      });
    },
  };
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
    vi.restoreAllMocks();
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
    const { onOpenExisting, onRequestCreate } = renderLauncher({
      error: "Could not refresh recent projects.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh recent projects.",
    );

    await user.click(screen.getByRole("button", { name: "Open project" }));
    expect(onOpenExisting).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(onRequestCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("renders canonical workspace project views without React key warnings", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderLauncher({
      projects: [makeProject(1), makeProject(2)],
    });

    expect(consoleErrorSpy.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringContaining('Each child in a list should have a unique "key" prop'),
        ]),
      ]),
    );
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
    mockRailLayout(rail, {
      cardWidth: 384,
      clientWidth: 1280,
      gap: 16,
      scrollWidth: 2000,
    });

    rail.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");

    expect(screen.getByRole("button", { name: "Open project Project 5" })).toHaveFocus();
    expect(HTMLElement.prototype.scrollBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ left: 400 }),
    );
    expect(HTMLElement.prototype.scrollBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ left: 400 }),
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

  it("uses the measured card width plus gap when the next button scrolls the rail", async () => {
    const user = userEvent.setup();
    renderLauncher({
      projects: [makeProject(1), makeProject(2), makeProject(3), makeProject(4)],
    });

    const rail = screen.getByRole("region", { name: "Recent projects" });
    mockRailLayout(rail, {
      cardWidth: 384,
      clientWidth: 1280,
      gap: 16,
      scrollWidth: 1600,
    });

    await user.click(screen.getByRole("button", { name: "Next projects" }));

    expect(HTMLElement.prototype.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", left: 400 }),
    );
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

  it("ignores horizontal touchpad wheel movement so native scrolling owns it", () => {
    renderLauncher({
      projects: [makeProject(1), makeProject(2), makeProject(3), makeProject(4)],
    });

    const rail = screen.getByRole("region", { name: "Recent projects" });
    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 120,
    });

    const dispatchResult = rail.dispatchEvent(wheelEvent);

    expect(dispatchResult).toBe(true);
    expect(wheelEvent.defaultPrevented).toBe(false);
    expect(HTMLElement.prototype.scrollBy).not.toHaveBeenCalled();
  });

  it("syncs rail controls to measured rail boundaries during scroll and resize", async () => {
    renderLauncher({
      projects: [
        makeProject(1),
        makeProject(2),
        makeProject(3),
        makeProject(4),
        makeProject(5),
      ],
    });

    const rail = screen.getByRole("region", { name: "Recent projects" });
    const previousButton = screen.getByRole("button", { name: "Previous projects" });
    const nextButton = screen.getByRole("button", { name: "Next projects" });
    const layout = mockRailLayout(rail, {
      cardWidth: 384,
      clientWidth: 1280,
      gap: 16,
      scrollWidth: 2000,
    });

    expect(previousButton).toBeDisabled();
    expect(nextButton).toBeEnabled();

    layout.setScrollLeft(700);
    fireEvent.scroll(rail);

    expect(previousButton).toBeEnabled();
    expect(nextButton).toBeEnabled();

    layout.setClientWidth(1299);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(nextButton).toBeDisabled();
    });

    layout.setClientWidth(1280);
    layout.setScrollLeft(720);
    fireEvent.scroll(rail);

    expect(nextButton).toBeDisabled();

    layout.setScrollLeft(0);
    fireEvent.scroll(rail);

    expect(previousButton).toBeDisabled();
    expect(nextButton).toBeEnabled();
  });

  it("does not enforce a fixed minimum width on the launcher shell", () => {
    renderLauncher();

    expect(screen.getByRole("main")).toHaveClass("min-h-screen");
    expect(screen.getByRole("main")).not.toHaveClass("min-w-[960px]");
  });

  it("opens the create dialog with form semantics, trims names, and resets after cancel or success", async () => {
    const user = userEvent.setup();
    const { onCreate, onRequestCreate } = renderLauncher();
    const trigger = screen.getByRole("button", { name: "New project" });

    await user.click(trigger);
    expect(onRequestCreate).toHaveBeenCalledTimes(1);

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
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const reopenedDialog = screen.getByRole("dialog");
    const reopenedInput = within(reopenedDialog).getByLabelText("Project name");
    expect(reopenedInput).toHaveValue("");

    await user.type(reopenedInput, "Temporary");
    await user.click(within(reopenedDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByLabelText("Project name")).toHaveValue("");
  });

  it("traps Tab and Shift+Tab within the create dialog", async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Project name");
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    const createButton = within(dialog).getByRole("button", { name: "Create project" });

    await user.type(input, "Editorial");
    await user.tab();
    expect(cancelButton).toHaveFocus();
    await user.tab();
    expect(createButton).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(createButton).toHaveFocus();
  });

  it("closes the create dialog on Escape even when focus moves outside the dialog", async () => {
    const user = userEvent.setup();
    renderLauncher();

    const trigger = screen.getByRole("button", { name: "New project" });
    await user.click(trigger);
    screen.getByRole("button", { name: "Open project" }).focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the original trigger when the create dialog closes with Cancel", async () => {
    const user = userEvent.setup();
    renderLauncher();

    const trigger = screen.getByRole("button", { name: "New project" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores focus to the original trigger when the create dialog closes with Escape", async () => {
    const user = userEvent.setup();
    renderLauncher();

    const trigger = screen.getByRole("button", { name: "New project" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
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
