import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { PlanCanvas } from "./PlanCanvas";

const planComponent: PlanComponent = {
  id: "plan1",
  type: "plan",
  width: 1,
  height: 220,
  html: "<p>拍摄清单</p>",
};

const referenceComponent: PlanComponent = {
  id: "ref1",
  type: "reference",
  width: 1,
  height: 320,
  title: "Lookbook",
  description: "",
  showCaptions: false, imageHeight: 180, images: [
    { id: "i1", file: "references/0001.png", aspectRatio: 1 },
    { id: "i2", file: "references/0002.png", aspectRatio: 1 },
  ],
};

function renderCanvas(overrides: Partial<Parameters<typeof PlanCanvas>[0]> = {}) {
  const props = {
    components: [planComponent, referenceComponent],
    scale: 1,
    imageSrc: (file: string) => (file.startsWith("references/") ? "data:image/png;base64,AA" : undefined),
    onRemoveComponent: vi.fn(),
    onChangeHtml: vi.fn(),
    onSetTitle: vi.fn(),
    onSetDescription: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    onMoveComponent: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
  render(
    <DndContext>
      <PlanCanvas {...props} />
    </DndContext>,
  );
  return props;
}

describe("PlanCanvas", () => {
  it("renders one A4 page with both plan and reference components", () => {
    renderCanvas();
    const pages = screen.getAllByTestId("canvas-page");
    expect(pages).toHaveLength(1);
  });

  it("plan component shows its editor", async () => {
    renderCanvas();
    const editor = screen.getByRole("group", { name: "摄影计划" });
    expect(editor).toBeInTheDocument();
    expect(await screen.findByText("拍摄清单")).toBeVisible();
  });

  it("reference component shows title and image tiles", () => {
    renderCanvas();
    const openButton = screen.getByRole("button", { name: "打开参考图 1" });
    expect(openButton).toBeVisible();
  });

  it("delete button opens confirm dialog and does not call onRemoveComponent immediately", () => {
    const props = renderCanvas();
    const deleteButtons = screen.getAllByRole("button", { name: "移除组件" });
    fireEvent.click(deleteButtons[0]);
    
    // Confirm dialog should be open
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("确定删除该组件？")).toBeInTheDocument();
    
    // onRemoveComponent should not be called yet
    expect(props.onRemoveComponent).not.toHaveBeenCalled();
  });

  it("clicking confirm in dialog calls onRemoveComponent with the component id", () => {
    const props = renderCanvas();
    const deleteButtons = screen.getAllByRole("button", { name: "移除组件" });
    fireEvent.click(deleteButtons[0]);
    
    // Click confirm button in dialog
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(props.onRemoveComponent).toHaveBeenCalledWith("plan1");
  });

  it("clicking cancel in dialog does not call onRemoveComponent", () => {
    const props = renderCanvas();
    const deleteButtons = screen.getAllByRole("button", { name: "移除组件" });
    fireEvent.click(deleteButtons[0]);
    
    // Click cancel button in dialog
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onRemoveComponent).not.toHaveBeenCalled();
    
    // Dialog should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders type label for plan component", () => {
    renderCanvas();
    expect(screen.getByText("摄影计划")).toBeInTheDocument();
  });

  it("renders type label for reference component", () => {
    renderCanvas();
    expect(screen.getByText("参考图组")).toBeInTheDocument();
  });

  it("top bar has draggable attributes and cursor-grab class", () => {
    renderCanvas();
    const topBar = document.querySelector('[data-component-frame-topbar="true"]');
    expect(topBar).toBeInTheDocument();
    expect(topBar).toHaveClass("cursor-grab");
    expect(topBar).toHaveAttribute("role", "button");
  });

  it("left resize handle exists with correct attributes", () => {
    renderCanvas();
    const leftHandle = document.querySelector('[data-resize-handle="left"]');
    expect(leftHandle).toBeInTheDocument();
    expect(leftHandle).toHaveClass("cursor-ew-resize");
  });

  it("top resize handle exists with correct attributes", () => {
    renderCanvas();
    const topHandle = document.querySelector('[data-resize-handle="top"]');
    expect(topHandle).toBeInTheDocument();
    expect(topHandle).toHaveClass("cursor-ns-resize");
  });

  it("right resize handle exists with correct attributes", () => {
    renderCanvas();
    const rightHandle = document.querySelector('[data-resize-handle="width"]');
    expect(rightHandle).toBeInTheDocument();
    expect(rightHandle).toHaveClass("cursor-ew-resize");
  });

  it("bottom resize handle exists with correct attributes", () => {
    renderCanvas();
    const bottomHandle = document.querySelector('[data-resize-handle="height"]');
    expect(bottomHandle).toBeInTheDocument();
    expect(bottomHandle).toHaveClass("cursor-ns-resize");
  });

  it("corner resize handle exists with correct attributes", () => {
    renderCanvas();
    const cornerHandle = document.querySelector('[data-resize-handle="both"]');
    expect(cornerHandle).toBeInTheDocument();
    expect(cornerHandle).toHaveClass("cursor-nwse-resize");
  });
});
