import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Rect } from "../../domain/plan/canvas/geometry";
import { SortableImageTile } from "./SortableImageTile";

describe("SortableImageTile", () => {
  const image = { id: "i1", file: "references/0001.png", caption: "" };
  const mockSlot: Rect = { x: 0, y: 24, width: 160, height: 120 };

  it("exposes sortable drag attributes and correct data type when draggable", () => {
    render(
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
        />
      </DndContext>,
    );

    const button = screen.getByRole("button", { name: "打开参考图 1" });
    expect(button).toHaveAttribute("aria-roledescription", "sortable");
    // The useSortable hook sets data: { type: "image", componentId }
    // We can't directly assert the data in jsdom, but we verify the draggable attributes exist
  });

  it("does not expose sortable attributes when draggable is false", () => {
    render(
      <DndContext>
        <SortableImageTile
          componentId="comp1"
          draggable={false}
          image={image}
          index={0}
          onOpen={vi.fn()}
          onRemove={vi.fn()}
          src="data:image/png;base64,AA"
          slot={mockSlot}
          scale={1}
        />
      </DndContext>,
    );

    const button = screen.getByRole("button", { name: "打开参考图 1" });
    expect(button).not.toHaveAttribute("aria-roledescription", "sortable");
  });

  it("opens image on click", () => {
    const onOpen = vi.fn();
    render(
      <DndContext>
        <SortableImageTile
          componentId="comp1"
          draggable={true}
          image={image}
          index={0}
          onOpen={onOpen}
          onRemove={vi.fn()}
          src="data:image/png;base64,AA"
          slot={mockSlot}
          scale={1}
        />
      </DndContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开参考图 1" }));
    expect(onOpen).toHaveBeenCalledWith("references/0001.png");
  });

  it("caption textarea and remove button stop propagation when draggable", () => {
    const onOpen = vi.fn();
    const onSetCaption = vi.fn();
    render(
      <DndContext>
        <SortableImageTile
          componentId="comp1"
          draggable={true}
          image={{ ...image, caption: "test" }}
          index={0}
          onOpen={onOpen}
          onRemove={vi.fn()}
          onSetCaption={onSetCaption}
          showCaptions={true}
          src="data:image/png;base64,AA"
          slot={mockSlot}
          scale={1}
        />
      </DndContext>,
    );

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

  it("caption textarea has explicit background for contrast", () => {
    // TDD: Failing test for Finding 3
    const onSetCaption = vi.fn();
    render(
      <DndContext>
        <SortableImageTile
          componentId="comp1"
          draggable={true}
          image={{ ...image, caption: "test" }}
          index={0}
          onOpen={vi.fn()}
          onRemove={vi.fn()}
          onSetCaption={onSetCaption}
          showCaptions={true}
          src="data:image/png;base64,AA"
          slot={mockSlot}
          scale={1}
        />
      </DndContext>,
    );

    const caption = screen.getByRole("textbox", { name: "图片说明 1" });
    // Should have bg-white or bg-stone-50 class
    expect(caption.className).toMatch(/bg-(white|stone-50)/);
  });
});
