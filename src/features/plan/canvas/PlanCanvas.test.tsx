import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { layoutPlan } from "../../../domain/plan/canvas/engine";
import { DEFAULT_PAGE_GEOMETRY, SPACING } from "../../../domain/plan/canvas/geometry";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { PlanCanvas } from "./PlanCanvas";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import { pageTopPx } from "./PagedCanvasSurface";

const mockRepository: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

const planComponent: PlanComponent = {
  id: "plan1",
  type: "plan",
  width: 1,
  html: "<p>拍摄清单</p>",
};

const referenceComponent: PlanComponent = {
  id: "ref1",
  type: "reference",
  width: 1,
  title: "Lookbook",
  description: "",
  showCaptions: false, imageHeight: 180, images: [
    { id: "i1", file: "references/0001.png", aspectRatio: 1 },
    { id: "i2", file: "references/0002.png", aspectRatio: 1 },
  ],
};

function makeReferenceImages(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `img-${index + 1}`,
    file: `references/${String(index + 1).padStart(4, "0")}.png`,
    aspectRatio: 1,
  }));
}

function renderCanvas(overrides: Partial<Parameters<typeof PlanCanvas>[0]> = {}) {
  const props = {
    components: [planComponent, referenceComponent],
    scale: 1,
    measurements: {
      planHeights: new Map<string, number>(),
      referenceDescriptionHeights: new Map<string, number>(),
    },
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
    onMeasurePlan: vi.fn(),
    onMeasureReferenceDescription: vi.fn(),
    ...overrides,
  };
  render(
    <ThemeProvider repository={mockRepository}>
      <DndContext>
        <PlanCanvas {...props} />
      </DndContext>
    </ThemeProvider>,
  );
  return props;
}

describe("PlanCanvas", () => {
  it("renders one A4 page background with both plan and reference components", () => {
    renderCanvas();
    const pages = screen.getAllByTestId("canvas-page-background");
    expect(pages).toHaveLength(1);
  });

  it("renders reference fragments in one continuous positioning surface", () => {
    const multiPageReference: PlanComponent = {
      ...referenceComponent,
      images: makeReferenceImages(12),
    };
    const layout = layoutPlan([multiPageReference], DEFAULT_PAGE_GEOMETRY);
    const continuation = layout.placements.find((placement) => placement.fragmentId === "ref1::1");

    expect(continuation).toBeDefined();

    renderCanvas({ components: [multiPageReference] });

    expect(screen.getByTestId("paged-canvas-surface")).toBeInTheDocument();
    expect(screen.getAllByTestId("canvas-page-background")).toHaveLength(layout.pageCount);

    const continuationFrame = document.querySelector('[data-fragment-id="ref1::1"]');
    expect(continuationFrame).toBeInTheDocument();
    expect(continuationFrame).toHaveStyle({
      top: `${pageTopPx(continuation!.pageIndex, 1) + (SPACING + continuation!.rect.y)}px`,
    });
  });

  it("marks continuation fragments with the logical component id", () => {
    const multiPageReference: PlanComponent = {
      ...referenceComponent,
      images: makeReferenceImages(12),
    };

    renderCanvas({ components: [multiPageReference] });

    const continuationFrame = document.querySelector('[data-fragment-id="ref1::1"]');
    expect(continuationFrame).toHaveAttribute("data-component-id", "ref1");
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

  it("anchors left-resize preview to the right edge", () => {
    renderCanvas({ components: [planComponent] });

    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    const leftHandle = document.querySelector('[data-resize-handle="left"]') as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      releasePointerCapture(pointerId: number): void;
    };

    leftHandle.setPointerCapture = vi.fn();
    leftHandle.releasePointerCapture = vi.fn();

    const initialLeft = parseFloat(frame.style.left);
    const initialWidth = parseFloat(frame.style.width);
    const initialRight = initialLeft + initialWidth;

    fireEvent.pointerDown(leftHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(leftHandle, { clientX: 260, pointerId: 1 });

    const previewLeft = parseFloat(frame.style.left);
    const previewWidth = parseFloat(frame.style.width);

    expect(previewLeft).toBeGreaterThan(initialLeft);
    expect(previewLeft + previewWidth).toBeCloseTo(initialRight, 5);
  });

  it("does not commit resize after pointercancel on the canvas", () => {
    const props = renderCanvas({ components: [planComponent] });

    const leftHandle = document.querySelector('[data-resize-handle="left"]') as HTMLElement & {
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
      setPointerCapture(pointerId: number): void;
    };

    leftHandle.setPointerCapture = vi.fn();
    leftHandle.releasePointerCapture = vi.fn();
    leftHandle.hasPointerCapture = vi.fn().mockReturnValue(true);

    fireEvent.pointerDown(leftHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(leftHandle, { clientX: 260, pointerId: 1 });
    fireEvent.pointerCancel(leftHandle, { pointerId: 1 });
    fireEvent.pointerUp(leftHandle, { pointerId: 1 });

    expect(leftHandle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(props.onResize).not.toHaveBeenCalled();
  });

  it("does not render a top resize handle", () => {
    renderCanvas();
    const topHandle = document.querySelector('[data-resize-handle="top"]');
    expect(topHandle).not.toBeInTheDocument();
  });

  it("right resize handle exists with correct attributes", () => {
    renderCanvas();
    const rightHandle = document.querySelector('[data-resize-handle="width"]');
    expect(rightHandle).toBeInTheDocument();
    expect(rightHandle).toHaveClass("cursor-ew-resize");
  });

  it("does not render a bottom resize handle", () => {
    renderCanvas();
    const bottomHandle = document.querySelector('[data-resize-handle="height"]');
    expect(bottomHandle).not.toBeInTheDocument();
  });

  it("does not render a corner resize handle", () => {
    renderCanvas();
    const cornerHandle = document.querySelector('[data-resize-handle="both"]');
    expect(cornerHandle).not.toBeInTheDocument();
  });
});
