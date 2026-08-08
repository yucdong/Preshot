// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
  html: "<p>Shot list</p>",
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
      plan: { schemaVersion: 8, title: "Demo", components: [] },
    })),
    onRenameComponent: vi.fn<() => RenameComponentResult>(() => ({
      ok: true,
      plan: { schemaVersion: 8, title: "Demo", components: [] },
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
      y: 60,
      width: 290,
      height: 140,
    });
  });

  it("keeps reference image DnD infrastructure inside the continuous card", () => {
    renderCanvas();
    expect(document.querySelector('[data-image-group-droppable-id]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
  });
});
