// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    const onAddImages = vi.fn();
    const onCaptureImage = vi.fn();
    const { rerender } = render(
      <GroupImageGrid
        enableReorder
        group={{ id: "group", images: [{ id: "image", file: "image.png" }] }}
        imageSrc={() => undefined}
        onOpenImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onAddImages={onAddImages}
        onCaptureImage={onCaptureImage}
        imageGuides={{ vertical: 120, horizontal: null }}
        slots={[{
          kind: "image",
          id: "image",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          imageHeight: 80,
          captionHeight: 0,
        }, {
          kind: "add",
          id: "__add__",
          x: 132,
          y: 0,
          width: 72,
          height: 72,
          imageHeight: 72,
          captionHeight: 0,
        }]}
        scale={1}
      />,
    );

    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
    expect(document.querySelector("[data-image-group-droppable-id]")).toBeInTheDocument();
    expect(screen.getByTestId("image-alignment-guide-vertical")).toHaveStyle({ left: "120px" });

    const addSlot = screen.getByTestId("image-add-slot");
    expect(within(addSlot).getByTestId("image-action-buttons")).toHaveClass("opacity-0");
    fireEvent.click(within(addSlot).getByRole("button", { name: "添加参考图" }));
    fireEvent.click(within(addSlot).getByRole("button", { name: "截图" }));
    expect(onAddImages).toHaveBeenCalledWith("group");
    expect(onCaptureImage).toHaveBeenCalledWith("group");

    rerender(
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
    expect(screen.queryByTestId("image-alignment-guide-vertical")).not.toBeInTheDocument();
  });
});
