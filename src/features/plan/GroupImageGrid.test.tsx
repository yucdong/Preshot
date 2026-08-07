// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupImageGrid } from "./GroupImageGrid";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: () => undefined }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  rectSortingStrategy: () => null,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

describe("GroupImageGrid", () => {
  it("renders explicit frame slots and keeps an image-group drop target", () => {
    render(
      <GroupImageGrid
        enableReorder
        group={{ id: "group", images: [{ id: "image", file: "image.png" }] }}
        imageSrc={() => undefined}
        onOpenImage={vi.fn()}
        onRemoveImage={vi.fn()}
        slots={[{
          kind: "image",
          id: "image",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          imageHeight: 80,
          captionHeight: 0,
        }]}
        scale={1}
      />,
    );

    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
    expect(document.querySelector("[data-image-group-droppable-id]")).toBeInTheDocument();
  });
});
