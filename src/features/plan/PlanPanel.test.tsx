import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanPanel } from "./PlanPanel";

const noop = {
  onAddGroup: vi.fn(),
  onRenameGroup: vi.fn(),
  onSetDescription: vi.fn(),
  onDeleteGroup: vi.fn(),
  onSetColumns: vi.fn(),
  onAddImage: vi.fn(),
  onRemoveImage: vi.fn(),
  onOpenImage: vi.fn(),
};

describe("PlanPanel", () => {
  it("shows the photography plan, reference images, and save status without tabs", () => {
    render(
      <PlanPanel
        groups={[]}
        imageSrc={() => undefined}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="saved"
        {...noop}
      />,
    );

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("heading", { name: "Shot notes" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Sample sets" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add reference group" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("All changes saved");
  });

  it("renders the photography plan editor", () => {
    render(
      <PlanPanel
        groups={[]}
        imageSrc={() => undefined}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan="<p>Plan body</p>"
        saveState="saved"
        {...noop}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Photography plan" })).toHaveTextContent("Plan body");
  });

  it("reflects the current save state", () => {
    render(
      <PlanPanel
        groups={[]}
        imageSrc={() => undefined}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="saving"
        {...noop}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
  });

  it("renders a contextual error banner when provided", () => {
    render(
      <PlanPanel
        error="Unable to load the project plan"
        groups={[]}
        imageSrc={() => undefined}
        onSetPhotographyPlan={vi.fn()}
        photographyPlan=""
        saveState="unsaved"
        {...noop}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load the project plan");
  });
});
