import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import { SortableImageTile } from "./SortableImageTile";

describe("SortableImageTile", () => {
  const image = { id: "i1", file: "references/0001.png", caption: "" };
  const mockSlot: ReferenceFlowSlot = { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 };

  function renderTile(overrides: Partial<Parameters<typeof SortableImageTile>[0]> = {}) {
    return render(
      <DndContext>
        <SortableImageTile
          componentId="comp1"
          draggable={true}
          image={image}
          index={0}
          onOpen={vi.fn()}
          onRemove={vi.fn()}
          src="data:image/png;base64,AA"
          slot={mockSlot}
          scale={1}
          {...overrides}
        />
      </DndContext>,
    );
  }

  it("exposes sortable drag attributes and correct data type when draggable", () => {
    renderTile();

    const button = screen.getByRole("button", { name: "打开参考图 1" });
    expect(button).toHaveAttribute("aria-roledescription", "sortable");
    // The useSortable hook sets data: { type: "image", componentId }
    // We can't directly assert the data in jsdom, but we verify the draggable attributes exist
  });

  it("does not expose sortable attributes when draggable is false", () => {
    renderTile({ draggable: false });

    const button = screen.getByRole("button", { name: "打开参考图 1" });
    expect(button).not.toHaveAttribute("aria-roledescription", "sortable");
  });

  it("opens image on click", () => {
    const onOpen = vi.fn();
    renderTile({ onOpen });

    fireEvent.click(screen.getByRole("button", { name: "打开参考图 1" }));
    expect(onOpen).toHaveBeenCalledWith("references/0001.png");
  });

  it("caption textarea and remove button stop propagation when draggable", () => {
    const onOpen = vi.fn();
    const onSetCaption = vi.fn();
    renderTile({
      image: { ...image, caption: "test" },
      onOpen,
      onSetCaption,
      showCaptions: true,
      slot: { ...mockSlot, imageHeight: 90, captionHeight: 30, height: 120 },
    });

    // Caption interaction should not trigger onOpen
    const caption = screen.getByRole("textbox", { name: "图片说明 1" });
    fireEvent.pointerDown(caption);
    fireEvent.click(caption);
    expect(onOpen).not.toHaveBeenCalled();

    // Remove button should not trigger onOpen
    const removeButton = screen.getByRole("button", { name: "移除参考图 1" });
    fireEvent.pointerDown(removeButton);
    fireEvent.click(removeButton);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders the image and caption as separate vertical regions", () => {
    renderTile({
      image: { ...image, caption: "test" },
      onSetCaption: vi.fn(),
      showCaptions: true,
      slot: { kind: "image", id: "i1", x: 0, y: 0, width: 180, height: 180, imageHeight: 135, captionHeight: 45 },
    });

    expect(screen.getByRole("img", { name: "参考图" })).toHaveClass("object-contain");
    expect(screen.getByTestId("image-region")).toHaveStyle({ height: "135px" });
    expect(screen.getByRole("textbox", { name: "图片说明 1" })).toHaveStyle({ height: "45px" });
  });

  it("renders a loading placeholder when src is missing", () => {
    renderTile({ src: undefined });

    expect(screen.queryByRole("img", { name: "参考图" })).toBeNull();
    expect(screen.getByText(/加载中/)).toBeVisible();
  });

  it("caption textarea has explicit background for contrast", () => {
    // TDD: Failing test for Finding 3
    const onSetCaption = vi.fn();
    renderTile({
      image: { ...image, caption: "test" },
      onSetCaption,
      showCaptions: true,
      slot: { ...mockSlot, imageHeight: 90, captionHeight: 30, height: 120 },
    });

    const caption = screen.getByRole("textbox", { name: "图片说明 1" });
    // Should have bg-white or bg-stone-50 class
    expect(caption.className).toMatch(/bg-(white|stone-50)/);
  });
});
