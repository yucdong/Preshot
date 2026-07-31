import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceGroup } from "../../domain/plan/models";
import { GroupImageGrid } from "./GroupImageGrid";

const group: ReferenceGroup = {
  id: "g1",
  title: "Lookbook",
  description: "",
  columnsPerRow: 3,
  images: [
    { id: "i1", file: "references/0001.png" },
    { id: "i2", file: "references/0002.png" },
  ],
};

function renderGrid(overrides: Partial<Parameters<typeof GroupImageGrid>[0]> = {}) {
  const props = {
    group,
    imageSrc: (file: string) => (file.startsWith("references/") ? "data:image/png;base64,AA" : undefined),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    ...overrides,
  };
  render(
    <DndContext>
      <GroupImageGrid {...props} />
    </DndContext>,
  );
  return props;
}

describe("GroupImageGrid", () => {
  it("renders each image as a sortable tile", () => {
    renderGrid();
    const open = screen.getByRole("button", { name: "Open reference image 1" });
    expect(open).toHaveAttribute("aria-roledescription", "sortable");
    expect(within(open).getByRole("img", { name: "Reference image 1" })).toBeVisible();
  });

  // dnd-kit's PointerSensor listeners suppress userEvent's synthetic
  // pointer->click sequence in jsdom, so these use fireEvent.click.
  // Real click-vs-drag coexistence is covered by e2e (plan.spec.ts
  // "Open reference image 1" opens the lightbox with the tile wired).

  it("opens an image on plain click", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Open reference image 1" }));
    expect(props.onOpenImage).toHaveBeenCalledWith("references/0001.png");
  });

  it("removes and adds images through the tile and add button", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Remove reference image 2" }));
    expect(props.onRemoveImage).toHaveBeenCalledWith("g1", "i2");
    fireEvent.click(screen.getByRole("button", { name: "Add reference image" }));
    expect(props.onAddImage).toHaveBeenCalledWith("g1");
  });
});
