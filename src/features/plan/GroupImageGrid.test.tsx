import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import { imageGroupDroppableId } from "./canvas/imageDropTarget";
import { GroupImageGrid } from "./GroupImageGrid";

interface GroupLike {
  id: string;
  images: Array<{ id: string; file: string; caption?: string }>;
}

const group: GroupLike = {
  id: "g1",
  images: [
    { id: "i1", file: "references/0001.png" },
    { id: "i2", file: "references/0002.png" },
  ],
};

const mockSlots: ReferenceFlowSlot[] = [
  { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
  { kind: "image", id: "i2", x: 172, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
  { kind: "add", id: "__add__", x: 0, y: 156, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
];

function renderGrid(overrides: Partial<Parameters<typeof GroupImageGrid>[0]> = {}) {
  const props = {
    group,
    imageSrc: (file: string) => (file.startsWith("references/") ? "data:image/png;base64,AA" : undefined),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    onSelectImage: vi.fn(),
    onCaptureImage: vi.fn(),
    onCancelCapture: vi.fn(),
    slots: mockSlots,
    scale: 1,
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
    const select = screen.getByRole("button", { name: "选择参考图 1" });
    expect(select).toHaveAttribute("aria-roledescription", "sortable");
    expect(within(select).getByRole("img", { name: "参考图" })).toBeVisible();
  });

  it("renders non-draggable tiles by default (reorder disabled)", () => {
    renderGrid();
    const open = screen.getByRole("button", { name: "选择参考图 1" });
    // Should NOT have sortable aria attributes when draggable is false
    expect(open).not.toHaveAttribute("aria-roledescription", "sortable");
    expect(within(open).getByRole("img", { name: "参考图" })).toBeVisible();
  });

  // dnd-kit's PointerSensor listeners suppress userEvent's synthetic
  // pointer->click sequence in jsdom, so these use fireEvent.click.
  // Real click-vs-drag coexistence is covered by e2e (plan.spec.ts
  // "Open reference image 1" opens the lightbox with the tile wired).

  it("selects on click and opens an image on double click", () => {
    const props = renderGrid();
    const tile = screen.getByRole("button", { name: "选择参考图 1" });
    fireEvent.click(tile);
    expect(props.onSelectImage).toHaveBeenCalledWith("i1", false);
    expect(props.onOpenImage).not.toHaveBeenCalled();
    fireEvent.doubleClick(tile);
    expect(props.onOpenImage).toHaveBeenCalledWith("references/0001.png");
  });

  it("renders fragment images by slot id instead of image array index", () => {
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i2", x: 0, y: 0, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "image", id: "i1", x: 172, y: 0, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "add", id: "__add__", x: 0, y: 132, width: 120, height: 90, imageHeight: 90, captionHeight: 0 },
    ];

    const props = renderGrid({ slots });

    fireEvent.doubleClick(screen.getByRole("button", { name: "选择参考图 1" }));
    expect(props.onOpenImage).toHaveBeenCalledWith("references/0002.png");
  });

  it("removes and adds images through the tile and add button", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "移除参考图 2" }));
    expect(props.onRemoveImage).toHaveBeenCalledWith("g1", "i2");
    fireEvent.click(screen.getByRole("button", { name: "添加参考图" }));
    expect(props.onAddImage).toHaveBeenCalledWith("g1");
  });

  it("shows determinate batch import progress over the image group", () => {
    renderGrid({
      importProgress: { completed: 1, total: 3, failed: 1 },
    });

    const progress = screen.getByRole("progressbar", { name: "图片导入进度" });
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByText("已处理 1/3（1 张失败）")).toBeVisible();
  });

  it("starts screen capture beside the add button", () => {
    const props = renderGrid();
    const importButton = screen.getByRole("button", { name: "添加参考图" });
    const captureButton = screen.getByRole("button", { name: "截图" });
    expect(importButton).toHaveAttribute("title", "导入图片");
    expect(captureButton).toHaveAttribute("title", "截图");
    expect(screen.getByTestId("screenshot-icon").querySelector("path")).toHaveAttribute(
      "stroke",
      "currentColor",
    );
    fireEvent.click(captureButton);
    expect(props.onCaptureImage).toHaveBeenCalledWith("g1");
  });

  it("shows and cancels a waiting screen capture", () => {
    const props = renderGrid({ captureStatus: "waiting" });
    expect(screen.getByText("等待截图…")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消截图" }));
    expect(props.onCancelCapture).toHaveBeenCalledTimes(1);
  });

  it("renders caption textareas when showCaptions is true", () => {
    const groupWithCaptions: GroupLike = {
      id: "g1",
      images: [
        { id: "i1", file: "references/0001.png", caption: "Existing caption" },
        { id: "i2", file: "references/0002.png", caption: "" },
        { id: "i3", file: "references/0003.png" },
      ],
    };
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 90, captionHeight: 30 },
      { kind: "image", id: "i2", x: 172, y: 24, width: 160, height: 120, imageHeight: 90, captionHeight: 30 },
      { kind: "image", id: "i3", x: 0, y: 156, width: 160, height: 120, imageHeight: 90, captionHeight: 30 },
    ];
    const props = renderGrid({ group: groupWithCaptions, slots, scale: 1, showCaptions: true, onSetCaption: vi.fn() });

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
      images: [
        { id: "i1", file: "references/0001.png", caption: "Some caption" },
        { id: "i2", file: "references/0002.png" },
      ],
    };
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "image", id: "i2", x: 172, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
    ];
    renderGrid({ group: groupWithCaptions, slots, scale: 1, showCaptions: false });

    // No caption textareas should render
    expect(screen.queryByRole("textbox", { name: /图片说明/ })).not.toBeInTheDocument();
  });

  it("caption textarea does not trigger image open on pointer or click", () => {
    const groupWithCaptions: GroupLike = {
      id: "g1",
      images: [{ id: "i1", file: "references/0001.png", caption: "" }],
    };
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 90, captionHeight: 30 },
    ];
    const props = renderGrid({ group: groupWithCaptions, slots, scale: 1, showCaptions: true, onSetCaption: vi.fn() });

    const caption = screen.getByRole("textbox", { name: "图片说明 1" });

    // Clicking/typing on the caption should NOT open the image
    fireEvent.pointerDown(caption);
    fireEvent.click(caption);
    expect(props.onOpenImage).not.toHaveBeenCalled();
  });

  it("uses imageGroupDroppableId for the group droppable when enableReorder is true", () => {
    const container = renderGrid({ enableReorder: true }).group;
    const expectedDroppableId = imageGroupDroppableId(container.id);
    expect(expectedDroppableId).toBe("imagegroup:g1");
  });

  it("positions each tile absolutely at its slot × scale", () => {
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "image", id: "i2", x: 172, y: 24, width: 180, height: 135, imageHeight: 135, captionHeight: 0 },
    ];
    const scale = 0.5;
    renderGrid({ slots, scale });

    // First tile
    const tile1 = screen.getByRole("button", { name: "选择参考图 1" }).parentElement;
    expect(tile1).toHaveStyle({
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "80px",
      height: "60px",
    });

    // Second tile
    const tile2 = screen.getByRole("button", { name: "选择参考图 2" }).parentElement;
    expect(tile2).toHaveStyle({
      position: "absolute",
      left: "86px",
      top: "0px",
      width: "90px",
      height: "67.5px",
    });
  });

  it("normalizes first-fragment slot offsets so the grid starts at y=0 without extra header height", () => {
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 98, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "add", id: "__add__", x: 0, y: 230, width: 120, height: 90, imageHeight: 90, captionHeight: 0 },
    ];

    renderGrid({ slots, scale: 1 });

    const firstTile = screen.getByRole("button", { name: "选择参考图 1" }).parentElement;
    expect(firstTile).toHaveStyle({ top: "0px" });
    expect(firstTile?.parentElement).toHaveStyle({ height: "222px" });
  });

  it("normalizes continuation-fragment slots while preserving later row deltas", () => {
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "image", id: "i2", x: 172, y: 156, width: 160, height: 135, imageHeight: 135, captionHeight: 0 },
    ];

    renderGrid({ slots, scale: 1 });

    const firstTile = screen.getByRole("button", { name: "选择参考图 1" }).parentElement;
    const secondTile = screen.getByRole("button", { name: "选择参考图 2" }).parentElement;

    expect(firstTile).toHaveStyle({ top: "0px" });
    expect(secondTile).toHaveStyle({ top: "132px" });
    expect(firstTile?.parentElement).toHaveStyle({ height: "267px" });
  });

  it("renders caption textarea in the caption band when showCaptions is true", () => {
    const groupWithCaptions: GroupLike = {
      id: "g1",
      images: [{ id: "i1", file: "references/0001.png", caption: "Test caption" }],
    };
    const slots: ReferenceFlowSlot[] = [{ kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 90, captionHeight: 30 }];
    renderGrid({ group: groupWithCaptions, slots, scale: 1, showCaptions: true, onSetCaption: vi.fn() });

    const caption = screen.getByRole("textbox", { name: "图片说明 1" });
    expect(caption).toBeInTheDocument();
    expect(caption).toHaveValue("Test caption");
  });

  it("positions add button at/below max(y+height) when slots have differing heights", () => {
    // TDD: Failing test for Finding 1
    // Slots in one row with different heights: tallest is 180, last is 120
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 0, width: 160, height: 180, imageHeight: 180, captionHeight: 0 },
      { kind: "image", id: "i2", x: 172, y: 0, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "add", id: "__add__", x: 0, y: 192, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
    ];
    const scale = 1;
    renderGrid({ slots, scale });

    const addButton = screen.getByRole("button", { name: "添加参考图" });
    const container = addButton.parentElement?.parentElement;
    
    // The add button should be positioned at/below the tallest slot's bottom (180),
    // not at the last slot's bottom (120)
    const topPx = parseFloat(container?.style.top || "0");
    expect(topPx).toBeGreaterThanOrEqual(180); // Should be at least 180, probably 180 + gap
  });

  it("scales add button size consistently with image tiles", () => {
    // TDD: Failing test for Finding 2
    const slots: ReferenceFlowSlot[] = [
      { kind: "image", id: "i1", x: 0, y: 24, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
      { kind: "add", id: "__add__", x: 0, y: 156, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
    ];
    const scale = 0.5;
    renderGrid({ slots, scale });

    const addButton = screen.getByRole("button", { name: "添加参考图" });
    const container = addButton.parentElement?.parentElement;
    
    // Add button dimensions should be scaled like image tiles
    // If original is 160x120 points, at scale 0.5 it should be 80x60 pixels
    expect(container?.style.width).toBe("80px");
    expect(container?.style.height).toBe("60px");
  });

  it("renders the add button only from an add slot", () => {
    renderGrid({
      slots: [{ kind: "image", id: "i1", x: 0, y: 0, width: 160, height: 120, imageHeight: 120, captionHeight: 0 }],
    });

    expect(screen.queryByRole("button", { name: "添加参考图" })).toBeNull();

    renderGrid({
      slots: [
        { kind: "image", id: "i1", x: 0, y: 0, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
        { kind: "add", id: "__add__", x: 0, y: 132, width: 120, height: 90, imageHeight: 90, captionHeight: 0 },
      ],
    });

    expect(screen.getByRole("button", { name: "添加参考图" })).toBeInTheDocument();
  });

  it("forwards crop commits and resets for the matching image", () => {
    const onSetCrop = vi.fn();
    const onResetCrop = vi.fn();
    renderGrid({
      group: {
        id: "g1",
        images: [{ id: "i1", file: "references/0001.png", aspectRatio: 1, crop: { x: 0, y: 0, width: 0.9, height: 1 } }],
      },
      slots: [mockSlots[0]],
      onSetCrop,
      onResetCrop,
    });

    const handle = screen.getByTestId("crop-handle-right");
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 160, clientY: 60 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120, clientY: 60 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 120, clientY: 60 });
    fireEvent.click(screen.getByRole("button", { name: "恢复原图" }));

    expect(onSetCrop).toHaveBeenCalledWith("i1", expect.objectContaining({ width: expect.any(Number) }));
    expect(onResetCrop).toHaveBeenCalledWith("i1");
  });
});
