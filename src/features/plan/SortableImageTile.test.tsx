// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortableImageTile } from "./SortableImageTile";

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { role: "button" },
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

describe("SortableImageTile", () => {
  it("renders its explicit frame slot and selection control", () => {
    render(
      <SortableImageTile
        componentId="reference"
        image={{
          id: "image",
          file: "image.png",
          aspectRatio: 2,
          frameWidth: 140,
          frameHeight: 90,
        }}
        index={0}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onSelect={vi.fn()}
        slot={{
          kind: "image",
          id: "image",
          x: 12,
          y: 8,
          width: 140,
          height: 90,
          imageHeight: 90,
          captionHeight: 0,
        }}
        scale={1}
        src={undefined}
      />,
    );

    const tile = screen.getByTestId("image-tile-image");
    expect(tile).toHaveStyle({ left: "12px", top: "8px", width: "140px", height: "90px" });
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
  });

  it("resizes arbitrary frame ratios from each edge, cover-fits the image, and resets defaults", () => {
    const onResizeFrame = vi.fn();
    const onResizePreview = vi.fn();
    render(
      <SortableImageTile
        componentId="reference"
        image={{
          id: "image",
          file: "image.png",
          aspectRatio: 2,
          frameWidth: 140,
          frameHeight: 90,
        }}
        index={0}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onResizeFrame={onResizeFrame}
        onResizePreview={onResizePreview}
        onSelect={vi.fn()}
        slot={{
          kind: "image",
          id: "image",
          x: 12,
          y: 8,
          width: 140,
          height: 90,
          imageHeight: 90,
          captionHeight: 0,
        }}
        scale={1}
        src="data:image/png;base64,AA=="
      />,
    );

    const renderedImage = screen.getByRole("img", { name: "参考图" });
    expect(renderedImage).not.toHaveClass("object-cover");
    expect(renderedImage).toHaveStyle({
      height: "100%",
      top: "0%",
    });
    expect(Number.parseFloat(renderedImage.style.width)).toBeGreaterThan(100);
    expect(Number.parseFloat(renderedImage.style.left)).toBeLessThan(0);
    for (const edge of ["left", "right", "top", "bottom"]) {
      expect(document.querySelector(`[data-image-resize-handle="${edge}"]`)).toBeInTheDocument();
    }

    const right = document.querySelector('[data-image-resize-handle="right"]') as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    right.setPointerCapture = vi.fn();
    right.hasPointerCapture = vi.fn().mockReturnValue(true);
    right.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(right, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(right, { pointerId: 1 });

    expect(onResizePreview).toHaveBeenCalledWith(
      "image",
      { frameWidth: 170, frameHeight: 90 },
      expect.anything(),
    );
    expect(onResizeFrame).toHaveBeenCalledWith("image", {
      frameWidth: 170,
      frameHeight: 90,
    });

    fireEvent.click(screen.getByRole("button", { name: "恢复原图视图" }));
    expect(onResizeFrame).toHaveBeenLastCalledWith("image", {
      frameWidth: 270,
      frameHeight: 135,
    });
  });

  it("snaps an image frame resize to a neighboring frame guide", () => {
    const onResizePreview = vi.fn();
    render(
      <SortableImageTile
        componentId="reference"
        image={{
          id: "image",
          file: "image.png",
          aspectRatio: 1,
          frameWidth: 100,
          frameHeight: 100,
        }}
        index={0}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onResizePreview={onResizePreview}
        onSelect={vi.fn()}
        slot={{
          kind: "image",
          id: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          imageHeight: 100,
          captionHeight: 0,
        }}
        snapCandidates={[{ x: 156, y: 220, width: 80, height: 80 }]}
        scale={1}
        src={undefined}
      />,
    );
    const right = document.querySelector('[data-image-resize-handle="right"]') as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    right.setPointerCapture = vi.fn();
    right.hasPointerCapture = vi.fn().mockReturnValue(true);
    right.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(right, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 150, pointerId: 1 });

    expect(onResizePreview).toHaveBeenCalledWith(
      "image",
      { frameWidth: 156, frameHeight: 100 },
      { vertical: 156, horizontal: null },
    );
  });

  it("pans and persists crop only in adjust-view mode, then resets to the full source", () => {
    const onSetCrop = vi.fn();
    render(
      <SortableImageTile
        componentId="reference"
        image={{
          id: "image",
          file: "image.png",
          aspectRatio: 2,
          frameWidth: 100,
          frameHeight: 100,
          crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        }}
        index={0}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onSelect={vi.fn()}
        onSetCrop={onSetCrop}
        slot={{
          kind: "image",
          id: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          imageHeight: 100,
          captionHeight: 0,
        }}
        scale={1}
        src="data:image/png;base64,AA=="
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "调整视图" }));
    const imageButton = screen.getByRole("button", { name: "选择参考图 1" }) as HTMLButtonElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    imageButton.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
      toJSON: () => ({}),
    });
    imageButton.setPointerCapture = vi.fn();
    imageButton.hasPointerCapture = vi.fn().mockReturnValue(true);
    imageButton.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(imageButton, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(imageButton, { clientX: 70, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(imageButton, { pointerId: 1 });

    expect(onSetCrop).toHaveBeenCalledWith("image", {
      x: 0.15,
      y: 0,
      width: 0.5,
      height: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "恢复原图视图" }));
    expect(onSetCrop).toHaveBeenLastCalledWith("image", {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});
