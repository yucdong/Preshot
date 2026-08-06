import type { ReactNode } from "react";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { layoutPlan } from "../../../domain/plan/canvas/engine";
import {
  componentFrameChromeHeight,
  DEFAULT_PAGE_GEOMETRY,
  EDITABLE_COMPONENT_FRAME_CHROME,
  SPACING,
} from "../../../domain/plan/canvas/geometry";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult, SetPlanTitleResult } from "../../../domain/plan/canvas/naming";
import { PlanCanvas } from "./PlanCanvas";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import { pageTopPx } from "./pagedCanvasMetrics";

const dndContextState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  sortableTransform: null as {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  } | null,
  rectCollisions: [] as Array<{ id: string | number }>,
  pointerCollisions: [] as Array<{ id: string | number }>,
  closestCollisions: [] as Array<{ id: string | number }>,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, ...props }: { children: ReactNode }) => {
    dndContextState.props = props as Record<string, unknown>;
    return children;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  PointerSensor: class PointerSensor {},
  useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => undefined }),
  rectIntersection: () => dndContextState.rectCollisions,
  pointerWithin: () => dndContextState.pointerCollisions,
  closestCorners: () => dndContextState.closestCollisions,
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  verticalListSortingStrategy: () => null,
  rectSortingStrategy: () => null,
  defaultAnimateLayoutChanges: () => true,
  useSortable: () => ({
    attributes: { role: "button", "aria-roledescription": "sortable" },
    listeners: {},
    setNodeRef: () => undefined,
    transform: dndContextState.sortableTransform,
    transition: null,
    isDragging: false,
  }),
}));

const mockRepository: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

const planComponent: PlanComponent = {
  id: "plan1",
  rowId: `row:${"plan1"}`,
  name: "文案1",
  type: "plan",
  width: 1,
  html: "<p>拍摄清单</p>",
};

const referenceComponent: PlanComponent = {
  id: "ref1",
  rowId: `row:${"ref1"}`,
  type: "reference",
  width: 1,
  name: "Lookbook",
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
    title: "Demo",
    onCommitTitle: vi.fn<() => SetPlanTitleResult>(() => ({
      ok: true,
      plan: { schemaVersion: 5, title: "Demo", components: [] },
    })),
    onRenameComponent: vi.fn<() => RenameComponentResult>(() => ({
      ok: true,
      plan: { schemaVersion: 5, title: "Demo", components: [] },
    })),
    onSetDescription: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    onMoveComponent: vi.fn(),
    onMoveImage: vi.fn(),
    onResize: vi.fn(),
    onMeasurePlan: vi.fn(),
    onMeasureReferenceDescription: vi.fn(),
    ...overrides,
  };
  render(
    <ThemeProvider repository={mockRepository}>
      <PlanCanvas {...props} />
    </ThemeProvider>,
  );
  return props;
}

function getDndHandlers() {
  return dndContextState.props as {
    onDragStart?: (event: unknown) => void;
    onDragOver?: (event: unknown) => void;
    onDragEnd?: (event: unknown) => void;
  };
}

function runCollisionDetection(
  activeType: "component" | "image",
  droppables: Array<{ id: string | number; type: string }>,
) {
  const collisionDetection = dndContextState.props?.collisionDetection as
    | ((args: unknown) => Array<{ id: string | number }>)
    | undefined;
  expect(collisionDetection).toBeTypeOf("function");

  return collisionDetection?.({
    active: { data: { current: { type: activeType } } },
    droppableContainers: droppables.map(({ id, type }) => ({
      id,
      data: { current: { type } },
    })),
  }) ?? [];
}

function componentFrameTop(fragmentId: string): number {
  const frame = document.querySelector(`[data-fragment-id="${fragmentId}"]`) as HTMLElement | null;
  expect(frame).not.toBeNull();
  return Number.parseFloat(frame!.style.top);
}

function makeRect(top: number, left = 0, width = 120, height = 120) {
  return { top, left, width, height };
}

function makeComponentDragStart(componentId: string) {
  return {
    active: {
      id: componentId,
      data: { current: { type: "component", componentId } },
      rect: { current: { translated: makeRect(0) } },
    },
  };
}

function makeComponentDragOver(componentId: string, overComponentId: string) {
  return {
    active: {
      id: componentId,
      data: { current: { type: "component", componentId } },
      rect: { current: { translated: makeRect(200) } },
    },
    over: {
      id: overComponentId,
      data: { current: { type: "component", componentId: overComponentId } },
      rect: makeRect(0),
    },
  };
}

function makeRowGapComponentDragOver(componentId: string, beforeRowId: string) {
  return {
    active: {
      id: componentId,
      data: { current: { type: "component", componentId } },
      rect: { current: { translated: makeRect(200) } },
    },
    over: {
      id: `row-gap:${beforeRowId}`,
      data: { current: { type: "row-gap", beforeRowId } },
      rect: makeRect(0),
    },
  };
}

function makeComponentDragCancel(componentId: string) {
  return {
    active: {
      id: componentId,
      data: { current: { type: "component", componentId } },
      rect: { current: { translated: makeRect(200) } },
    },
    over: null,
  };
}

function makeImageDragStart(componentId: string, imageId: string) {
  return {
    active: {
      id: imageId,
      data: { current: { type: "image", componentId } },
      rect: { current: { translated: makeRect(0, 200, 120, 120) } },
    },
  };
}

function makeImageDragOver(componentId: string, imageId: string, overId: string) {
  return {
    active: {
      id: imageId,
      data: { current: { type: "image", componentId } },
      rect: { current: { translated: makeRect(0, 200, 120, 120) } },
    },
    over: {
      id: overId,
      data: { current: { type: "imagegroup", componentId: overId.replace("imagegroup:", "") } },
      rect: makeRect(0, 0, 120, 120),
    },
  };
}

function makeImageDragCancel(componentId: string, imageId: string) {
  return {
    active: {
      id: imageId,
      data: { current: { type: "image", componentId } },
      rect: { current: { translated: makeRect(0, 200, 120, 120) } },
    },
    over: null,
  };
}

describe("PlanCanvas", () => {
  beforeEach(() => {
    dndContextState.props = null;
    dndContextState.sortableTransform = null;
    dndContextState.rectCollisions = [];
    dndContextState.pointerCollisions = [];
    dndContextState.closestCollisions = [];
  });

  it("renders one A4 page background with both plan and reference components", () => {
    renderCanvas();
    const pages = screen.getAllByTestId("canvas-page-background");
    expect(pages).toHaveLength(1);
  });

  it("renders one editable document title in the first-page title band", () => {
    renderCanvas({ title: "Campaign" });

    const titles = screen.getAllByRole("textbox", { name: "画布标题" });
    expect(titles).toHaveLength(1);
    expect(titles[0]).toHaveValue("Campaign");
  });

  it.each([0.5, 1.75])(
    "keeps measured plan content inside frame chrome at scale %s",
    (scale) => {
      const measuredHeight = 100;
      renderCanvas({
        components: [planComponent],
        measurements: {
          planHeights: new Map([["plan1", measuredHeight]]),
          referenceDescriptionHeights: new Map<string, number>(),
        },
        scale,
      });

      const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
      const body = frame.querySelector("[data-component-frame-body]") as HTMLElement;
      const chromeHeight = componentFrameChromeHeight(EDITABLE_COMPONENT_FRAME_CHROME);

      expect(frame.style.height).toBe(`${(measuredHeight + chromeHeight) * scale}px`);
      expect(body.style.height).toBe(`${measuredHeight * scale}px`);
    },
  );

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

  it("keeps one long reference editor and places following frames after every reference fragment", () => {
    const longReference: PlanComponent = {
      ...referenceComponent,
      description: "<p>Long reference description</p>",
    };

    renderCanvas({
      components: [longReference, planComponent],
      measurements: {
        planHeights: new Map([["plan1", 80]]),
        referenceDescriptionHeights: new Map([["ref1", 1800]]),
      },
    });

    expect(screen.getAllByRole("group", { name: "分组描述" })).toHaveLength(1);

    const referenceFrames = Array.from(
      document.querySelectorAll(
        '[data-component-frame="true"][data-component-id="ref1"]',
      ),
    ) as HTMLElement[];
    const followingFrame = document.querySelector(
      '[data-component-frame="true"][data-component-id="plan1"]',
    ) as HTMLElement;
    const finalReferenceBottom = Math.max(
      ...referenceFrames.map(
        (frame) =>
          Number.parseFloat(frame.style.top) +
          Number.parseFloat(frame.style.height),
      ),
    );

    expect(referenceFrames.length).toBeGreaterThan(1);
    expect(Number.parseFloat(followingFrame.style.top)).toBeGreaterThanOrEqual(
      finalReferenceBottom,
    );
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

  it("gives paginated reference fragments unique image-group droppable ids while keeping one logical sortable frame", () => {
    const multiPageReference: PlanComponent = {
      ...referenceComponent,
      images: makeReferenceImages(12),
    };

    renderCanvas({ components: [multiPageReference] });

    const fragments = Array.from(document.querySelectorAll("[data-image-group-droppable-id]"));
    const droppableIds = fragments.map((element) => element.getAttribute("data-image-group-droppable-id"));

    expect(new Set(droppableIds).size).toBe(droppableIds.length);
    expect(fragments.every((element) => element.getAttribute("data-component-id") === "ref1")).toBe(true);
    expect(document.querySelectorAll('[data-sortable-component-id="ref1"]')).toHaveLength(1);
  });

  it("pins every source fragment while non-active preview components keep sortable transforms", () => {
    dndContextState.sortableTransform = { x: 24, y: 16, scaleX: 1, scaleY: 1 };
    const multiPageReference: PlanComponent = {
      ...referenceComponent,
      images: makeReferenceImages(12),
    };

    renderCanvas({ components: [multiPageReference, planComponent] });
    const handlers = getDndHandlers();

    act(() => {
      handlers.onDragStart?.(makeComponentDragStart("ref1"));
    });

    const sourceFragments = Array.from(
      document.querySelectorAll(
        '[data-component-frame="true"][data-component-id="ref1"]',
      ),
    ) as HTMLElement[];
    const nonActiveFrame = document.querySelector(
      '[data-component-frame="true"][data-component-id="plan1"]',
    ) as HTMLElement;

    expect(sourceFragments.length).toBeGreaterThan(1);
    expect(
      sourceFragments.every(
        (fragment) =>
          fragment.dataset.dragPlaceholder === "component" &&
          fragment.style.transform === "",
      ),
    ).toBe(true);
    expect(nonActiveFrame.style.transform).not.toBe("");
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

  it("renders the plan component name in frame chrome", () => {
    renderCanvas();
    expect(screen.getByDisplayValue("文案1")).toBeInTheDocument();
  });

  it("renders the reference component name in frame chrome", () => {
    renderCanvas();
    expect(screen.getByDisplayValue("Lookbook")).toBeInTheDocument();
  });

  it("uses a cropped image's effective aspect ratio for reference slots", () => {
    renderCanvas({
      components: [{
        ...referenceComponent,
        images: [{
          id: "i1",
          file: "references/0001.png",
          aspectRatio: 2,
          crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
        }],
      }],
    });

    const tile = document.querySelector('[data-image-id="i1"]') as HTMLElement;
    expect(tile.style.width).toBe("180px");
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

  it("clears component preview on invalid over and does not commit the stale move when dropped outside", () => {
    const props = renderCanvas();
    const initialReferenceTop = componentFrameTop("ref1::0");
    const handlers = getDndHandlers();

    act(() => {
      handlers.onDragStart?.(makeComponentDragStart("plan1"));
      handlers.onDragOver?.(makeComponentDragOver("plan1", "ref1"));
    });

    expect(componentFrameTop("ref1::0")).toBeCloseTo(initialReferenceTop, 5);

    act(() => {
      handlers.onDragOver?.(makeComponentDragCancel("plan1"));
    });

    expect(componentFrameTop("ref1::0")).toBeCloseTo(initialReferenceTop, 5);

    act(() => {
      handlers.onDragEnd?.(makeComponentDragCancel("plan1"));
    });

    expect(props.onMoveComponent).not.toHaveBeenCalled();
  });

  it("commits a row-gap drop before the remaining rows after removing a singleton source", () => {
    const props = renderCanvas();
    const handlers = getDndHandlers();
    const event = makeRowGapComponentDragOver("plan1", "row:ref1");

    act(() => {
      handlers.onDragStart?.(makeComponentDragStart("plan1"));
      handlers.onDragOver?.(event);
      handlers.onDragEnd?.(event);
    });

    expect(props.onMoveComponent).toHaveBeenCalledWith("plan1", {
      kind: "new-row",
      rowId: expect.stringMatching(/^row-/),
      toRowIndex: 0,
    });
  });

  it("does not commit a stale image move when dropped outside all droppables", () => {
    const targetReference: PlanComponent = {
      ...referenceComponent,
      id: "ref2",
      name: "Target",
      images: [],
    };
    const props = renderCanvas({ components: [referenceComponent, targetReference] });
    const handlers = getDndHandlers();

    act(() => {
      handlers.onDragStart?.(makeImageDragStart("ref1", "i1"));
      handlers.onDragOver?.(makeImageDragOver("ref1", "i1", "imagegroup:ref2"));
      handlers.onDragOver?.(makeImageDragCancel("ref1", "i1"));
      handlers.onDragEnd?.(makeImageDragCancel("ref1", "i1"));
    });

    expect(props.onMoveImage).not.toHaveBeenCalled();
  });

  it.each([
    ["component", "plan1", "component"],
    ["image", "i2", "image"],
  ] as const)(
    "returns no %s collision when the pointer is outside the canvas",
    (activeType, targetId, targetType) => {
      renderCanvas();
      dndContextState.closestCollisions = [{ id: targetId }];

      expect(
        runCollisionDetection(activeType, [
          { id: "canvas", type: "canvas" },
          { id: targetId, type: targetType },
        ]),
      ).toEqual([]);
    },
  );

  it.each([
    ["component", "plan1", "component"],
    ["image", "imagegroup:ref1", "imagegroup"],
  ] as const)(
    "uses the closest valid %s target for blank space inside the canvas",
    (activeType, targetId, targetType) => {
      renderCanvas();
      dndContextState.pointerCollisions = [{ id: "canvas" }];
      dndContextState.closestCollisions = [
        { id: "canvas" },
        { id: targetId },
      ];

      expect(
        runCollisionDetection(activeType, [
          { id: "canvas", type: "canvas" },
          { id: targetId, type: targetType },
        ]),
      ).toEqual([{ id: targetId }]);
    },
  );
});
