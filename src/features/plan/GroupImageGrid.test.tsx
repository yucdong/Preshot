import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupImageGrid } from "./GroupImageGrid";

interface GroupLike {
  id: string;
  columnsPerRow: number;
  images: Array<{ id: string; file: string; caption?: string }>;
}

const group: GroupLike = {
  id: "g1",
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
  it("renders each image as a sortable tile when reorder is enabled", () => {
    renderGrid({ enableReorder: true });
    const open = screen.getByRole("button", { name: "打开参考图 1" });
    expect(open).toHaveAttribute("aria-roledescription", "sortable");
    expect(within(open).getByRole("img", { name: "参考图" })).toBeVisible();
  });

  it("renders non-draggable tiles by default (reorder disabled)", () => {
    renderGrid();
    const open = screen.getByRole("button", { name: "打开参考图 1" });
    // Should NOT have sortable aria attributes when draggable is false
    expect(open).not.toHaveAttribute("aria-roledescription", "sortable");
    expect(within(open).getByRole("img", { name: "参考图" })).toBeVisible();
  });

  // dnd-kit's PointerSensor listeners suppress userEvent's synthetic
  // pointer->click sequence in jsdom, so these use fireEvent.click.
  // Real click-vs-drag coexistence is covered by e2e (plan.spec.ts
  // "Open reference image 1" opens the lightbox with the tile wired).

  it("opens an image on plain click", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "打开参考图 1" }));
    expect(props.onOpenImage).toHaveBeenCalledWith("references/0001.png");
  });

  it("removes and adds images through the tile and add button", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "移除参考图 2" }));
    expect(props.onRemoveImage).toHaveBeenCalledWith("g1", "i2");
    fireEvent.click(screen.getByRole("button", { name: "添加参考图" }));
    expect(props.onAddImage).toHaveBeenCalledWith("g1");
  });

  it("renders caption textareas when showCaptions is true", () => {
    const groupWithCaptions: GroupLike = {
      id: "g1",
      columnsPerRow: 2,
      images: [
        { id: "i1", file: "references/0001.png", caption: "Existing caption" },
        { id: "i2", file: "references/0002.png", caption: "" },
        { id: "i3", file: "references/0003.png" },
      ],
    };
    const props = renderGrid({ group: groupWithCaptions, showCaptions: true, onSetCaption: vi.fn() });

    // Each image should have a caption textarea
    const caption1 = screen.getByRole("textbox", { name: "图片说明 1" });
    expect(caption1).toHaveValue("Existing caption");

    const caption2 = screen.getByRole("textbox", { name: "图片说明 2" });
    expect(caption2).toHaveValue("");

    const caption3 = screen.getByRole("textbox", { name: "图片说明 3" });
    expect(caption3).toHaveValue("");

    // Typing should call onSetCaption
    fireEvent.change(caption1, { target: { value: "Updated caption" } });
    expect(props.onSetCaption).toHaveBeenCalledWith("i1", "Updated caption");
  });

  it("does not render caption textareas when showCaptions is false or undefined", () => {
    const groupWithCaptions: GroupLike = {
      id: "g1",
      columnsPerRow: 2,
      images: [
        { id: "i1", file: "references/0001.png", caption: "Some caption" },
        { id: "i2", file: "references/0002.png" },
      ],
    };
    renderGrid({ group: groupWithCaptions, showCaptions: false });

    // No caption textareas should render
    expect(screen.queryByRole("textbox", { name: /图片说明/ })).not.toBeInTheDocument();
  });

  it("caption textarea does not trigger image open on pointer or click", () => {
    const groupWithCaptions: GroupLike = {
      id: "g1",
      columnsPerRow: 2,
      images: [{ id: "i1", file: "references/0001.png", caption: "" }],
    };
    const props = renderGrid({ group: groupWithCaptions, showCaptions: true, onSetCaption: vi.fn() });

    const caption = screen.getByRole("textbox", { name: "图片说明 1" });

    // Clicking/typing on the caption should NOT open the image
    fireEvent.pointerDown(caption);
    fireEvent.click(caption);
    expect(props.onOpenImage).not.toHaveBeenCalled();
  });
});
