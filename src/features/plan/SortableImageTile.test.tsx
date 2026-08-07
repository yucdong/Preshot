// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
        image={{ id: "image", file: "image.png" }}
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
});
