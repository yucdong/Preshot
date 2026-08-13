// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import type {
  RenameComponentResult,
  SetPlanTitleResult,
} from "../../../domain/plan/canvas/naming";
import { PlanCanvas } from "./PlanCanvas";

const dndState = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, ...props }: { children: ReactNode }) => {
    dndState.props = props as Record<string, unknown>;
    return children;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  PointerSensor: class PointerSensor {},
  useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => undefined }),
  useDraggable: () => ({
    attributes: { role: "button" },
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
  }),
  pointerWithin: () => [],
  rectIntersection: () => [],
  closestCorners: () => [],
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
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

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

const plan: PlanComponent = {
  id: "plan1",
  name: "Plan",
  type: "plan",
  x: 20,
  width: 260,
  height: 140,
  textRoot: { kind: "leaf", id: "plan1:root", html: "<p>Shot list</p>" },
};

const reference: PlanComponent = {
  id: "ref1",
  name: "Reference",
  type: "reference",
  x: 310,
  width: 200,
  height: 220,
  description: "",
  images: [{
    id: "image1",
    file: "references/image.png",
    aspectRatio: 1,
    frameWidth: 100,
    frameHeight: 100,
  }],
};

function renderCanvas(overrides: Partial<Parameters<typeof PlanCanvas>[0]> = {}) {
  const props = {
    components: [plan, reference],
    title: "Demo",
    scale: 1,
    imageSrc: () => undefined,
    onRemoveComponent: vi.fn(),
    onChangeHtml: vi.fn(),
    onCommitTitle: vi.fn<() => SetPlanTitleResult>(() => ({
      ok: true,
      plan: { schemaVersion: 12, title: "Demo", components: [] },
    })),
    onRenameComponent: vi.fn<() => RenameComponentResult>(() => ({
      ok: true,
      plan: { schemaVersion: 12, title: "Demo", components: [] },
    })),
    onSetDescription: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    onReorderComponent: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
  render(
    <ThemeProvider repository={settings}>
      <PlanCanvas {...props} />
    </ThemeProvider>,
  );
  return props;
}

describe("PlanCanvas v8", () => {
  beforeEach(() => {
    dndState.props = null;
  });

  it("renders one continuous v12 editor with atomic image groups and image-group-only insertion", async () => {
    const onChangeDocumentHtml = vi.fn();
    const onCreateImageGroup = vi.fn();
    renderCanvas({
      components: [reference],
      documentHtml:
        '<p>Before</p><figure data-preshot-node="image-group" data-preshot-group-id="ref1"></figure><p>After</p><p></p>',
      imageSrc: () => "data:image/png;base64,AA==",
      onChangeDocumentHtml,
      onCreateImageGroup,
    });

    expect(await screen.findByRole("textbox", { name: "方案正文" })).toBeVisible();
    expect(screen.getAllByRole("textbox", { name: "方案正文" })).toHaveLength(1);
    expect(document.querySelectorAll('[data-image-group-id="ref1"]')).toHaveLength(1);
    expect(document.querySelector("[data-component-frame=true]")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^插入$/ }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeVisible();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "图片组" }));

    await waitFor(() => expect(onCreateImageGroup).toHaveBeenCalledOnce());
    await waitFor(() => {
      const nextHtml = onChangeDocumentHtml.mock.calls.at(-1)?.[0] as string | undefined;
      expect(nextHtml?.match(/data-preshot-node="image-group"/g)).toHaveLength(2);
    });
  });

  it("supports eight-way image resize and four-corner image-group resize in document mode", async () => {
    const onOpenDocumentImage = vi.fn();
    const onRemoveImage = vi.fn();
    const onResize = vi.fn();
    const onScaleReferenceImages = vi.fn();
    const onSetImageFrame = vi.fn();
    renderCanvas({
      components: [{ ...reference, x: 100 }],
      documentHtml:
        '<figure data-preshot-node="image-group" data-preshot-group-id="ref1"></figure><p></p>',
      imageSrc: () => "data:image/png;base64,AA==",
      onChangeDocumentHtml: vi.fn(),
      onCreateImageGroup: vi.fn(),
      onOpenDocumentImage,
      onRemoveImage,
      onResize,
      onScaleReferenceImages,
      onSetImageFrame,
    });

    const image = await screen.findByRole("button", { name: "选择参考图 1" });
    fireEvent.click(image);
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBe(image);
    expect(document.querySelector(".preshot-document-image-index")).toHaveTextContent("01");
    const imageFrame = image.closest(".preshot-document-image-frame") as HTMLElement;
    expect(within(imageFrame).queryByRole("button", { name: "删除参考图 1" }))
      .not.toBeInTheDocument();
    const imageToolbar = screen.getByRole("toolbar", { name: "图片属性" });
    fireEvent.click(within(imageToolbar).getByRole("button", { name: "删除图片" }));
    expect(onRemoveImage).toHaveBeenCalledWith("ref1", "image1");
    expect(document.querySelectorAll('[data-image-resize-handle="edge"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-image-resize-handle="corner"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-group-resize-handle="edge"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-group-resize-handle="corner"]')).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "恢复参考图 1" })).not.toBeInTheDocument();

    const imageCorner = document.querySelector(
      '[data-image-resize-edge="bottom-right"]',
    )!;
    fireEvent.pointerDown(imageCorner, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 140, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 140, clientY: 130, pointerId: 1 });
    expect(onSetImageFrame).toHaveBeenLastCalledWith("ref1", "image1", {
      frameWidth: 140,
      frameHeight: 130,
    });

    const leftEdge = document.querySelector('[data-image-resize-edge="left"]')!;
    fireEvent.pointerDown(leftEdge, { clientX: 100, clientY: 100, pointerId: 3 });
    fireEvent.pointerMove(document, { clientX: 80, clientY: 100, pointerId: 3 });
    fireEvent.pointerUp(document, { clientX: 80, clientY: 100, pointerId: 3 });
    expect(onSetImageFrame).toHaveBeenLastCalledWith("ref1", "image1", {
      frameWidth: 120,
      frameHeight: 100,
    });

    const rightEdge = document.querySelector('[data-image-resize-edge="right"]')!;
    fireEvent.pointerDown(rightEdge, { clientX: 100, clientY: 100, pointerId: 4 });
    fireEvent.pointerMove(document, { clientX: 124, clientY: 100, pointerId: 4 });
    fireEvent.pointerUp(document, { clientX: 124, clientY: 100, pointerId: 4 });
    expect(onSetImageFrame).toHaveBeenLastCalledWith("ref1", "image1", {
      frameWidth: 124,
      frameHeight: 100,
    });

    fireEvent.doubleClick(screen.getByRole("button", { name: "选择参考图 1" }));
    expect(onOpenDocumentImage).toHaveBeenCalledWith(
      "ref1",
      "image1",
      "references/image.png",
    );

    const groupCorner = document.querySelector(
      '[data-group-resize-edge="bottom-right"]',
    )!;
    fireEvent.pointerDown(groupCorner, { clientX: 200, clientY: 220, pointerId: 2 });
    fireEvent.pointerMove(document, { clientX: 240, clientY: 260, pointerId: 2 });
    fireEvent.pointerUp(document, { clientX: 240, clientY: 260, pointerId: 2 });
    expect(onResize).toHaveBeenLastCalledWith("ref1", {
      x: 100,
      width: 240,
      height: 260,
    });

    expect(screen.getByRole("toolbar", { name: "图片组属性" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "缩小组内全部图片" }));
    fireEvent.click(screen.getByRole("button", { name: "放大组内全部图片" }));
    expect(onScaleReferenceImages).toHaveBeenNthCalledWith(1, "ref1", 0.9);
    expect(onScaleReferenceImages).toHaveBeenNthCalledWith(2, "ref1", 1.1);
    fireEvent.wheel(document, { deltaY: 40 });
    expect(screen.queryByRole("toolbar", { name: "图片组属性" })).not.toBeInTheDocument();
  });

  it("renders exact A4 page backgrounds instead of a continuous surface", () => {
    renderCanvas();

    expect(screen.queryByTestId("continuous-canvas-surface")).not.toBeInTheDocument();
    expect(screen.getByTestId("paged-canvas-surface")).toBeInTheDocument();
    expect(screen.queryAllByTestId("canvas-page-background")).toHaveLength(1);
  });

  it("renders card rectangles from document order while retaining x/width/height", () => {
    renderCanvas();
    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;

    expect(frame).toHaveStyle({
      left: "20px",
      top: "60px",
      width: "260px",
      height: "140px",
    });
  });

  it("reorders components one position with edge arrow buttons", () => {
    const props = renderCanvas();
    const upButtons = screen.getAllByRole("button", { name: "上移一个位置" });
    const downButtons = screen.getAllByRole("button", { name: "下移一个位置" });

    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[1]).toBeDisabled();
    fireEvent.click(downButtons[0]);
    fireEvent.click(upButtons[1]);
    expect(props.onReorderComponent).toHaveBeenNthCalledWith(1, "plan1", 1);
    expect(props.onReorderComponent).toHaveBeenNthCalledWith(2, "ref1", 0);
    expect(document.querySelector("[data-component-drag-handle]")).not.toBeInTheDocument();
  });

  it("previews snapped card resizing with a guide and reverts it when cancelled", () => {
    const props = renderCanvas();
    const resize = () => {
      const right = document.querySelector(
        '[data-component-id="plan1"] [data-resize-handle="right"]',
      ) as HTMLElement & {
        setPointerCapture(pointerId: number): void;
        hasPointerCapture(pointerId: number): boolean;
        releasePointerCapture(pointerId: number): void;
      };
      right.setPointerCapture = vi.fn();
      right.hasPointerCapture = vi.fn().mockReturnValue(true);
      right.releasePointerCapture = vi.fn();
      fireEvent.pointerDown(right, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(right, { clientX: 126, pointerId: 1 });
      return right;
    };

    let right = resize();
    expect(document.querySelector('[data-component-id="plan1"]')).toHaveStyle({
      width: "290px",
    });
    fireEvent.pointerCancel(right, { pointerId: 1 });
    expect(document.querySelector('[data-component-id="plan1"]')).toHaveStyle({
      width: "260px",
    });

    right = resize();
    fireEvent.pointerUp(right, { pointerId: 1 });
    expect(props.onResize).toHaveBeenCalledWith("plan1", {
      x: 20,
      width: 290,
    });
  });

  it("stops plan resizing at recursive content limits and clears feedback when enlarged", () => {
    renderCanvas({
      components: [{
        ...plan,
        textRoot: {
          kind: "split",
          id: "split",
          direction: "columns",
          gap: 10,
          children: [
            plan.textRoot,
            { kind: "leaf", id: "right", html: "<p>Right</p>" },
          ],
        },
      }, reference],
      measurements: {
        planHeights: new Map([["plan1", 100]]),
        referenceDescriptionHeights: new Map(),
      },
    });
    const right = document.querySelector(
      '[data-component-id="plan1"] [data-resize-handle="right"]',
    ) as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    right.setPointerCapture = vi.fn();
    right.hasPointerCapture = vi.fn().mockReturnValue(true);
    right.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(right, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 0, pointerId: 1 });
    expect(document.querySelector('[data-component-id="plan1"]')).toHaveStyle({
      width: "306px",
    });
    expect(screen.getByRole("status")).toHaveTextContent("内容已达到最小尺寸");
    expect(right).toHaveAttribute("data-resize-limited", "true");

    fireEvent.pointerMove(right, { clientX: 400, pointerId: 1 });
    expect(screen.queryByText("内容已达到最小尺寸")).not.toBeInTheDocument();
    expect(right).not.toHaveAttribute("data-resize-limited");
  });

  it("stops vertical plan resizing at measured natural content height", () => {
    renderCanvas({
      measurements: {
        planHeights: new Map([["plan1", 100]]),
        referenceDescriptionHeights: new Map(),
      },
    });
    const bottom = document.querySelector(
      '[data-component-id="plan1"] [data-resize-handle="bottom"]',
    ) as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    bottom.setPointerCapture = vi.fn();
    bottom.hasPointerCapture = vi.fn().mockReturnValue(true);
    bottom.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(bottom, { clientY: 140, pointerId: 1 });
    fireEvent.pointerMove(bottom, { clientY: 0, pointerId: 1 });
    expect(document.querySelector('[data-component-id="plan1"]')).toHaveStyle({
      height: "112px",
    });
    expect(screen.getByRole("status")).toHaveTextContent("内容已达到最小尺寸");
  });

  it("keeps reference image DnD infrastructure inside the continuous card", () => {
    renderCanvas();
    expect(document.querySelector('[data-image-group-droppable-id]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
  });
});
