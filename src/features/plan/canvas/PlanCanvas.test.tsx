// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
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
  y: 100,
  width: 260,
  height: 140,
  html: "<p>Shot list</p>",
};

const reference: PlanComponent = {
  id: "ref1",
  name: "Reference",
  type: "reference",
  x: 310,
  y: 280,
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
      plan: { schemaVersion: 7, title: "Demo", components: [] },
    })),
    onRenameComponent: vi.fn<() => RenameComponentResult>(() => ({
      ok: true,
      plan: { schemaVersion: 7, title: "Demo", components: [] },
    })),
    onSetDescription: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    onMoveComponent: vi.fn(),
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

describe("PlanCanvas v7", () => {
  beforeEach(() => {
    dndState.props = null;
  });

  it("renders one fixed-width continuous surface without A4 page backgrounds", () => {
    renderCanvas();

    expect(screen.getByTestId("continuous-canvas-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("paged-canvas-surface")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("canvas-page-background")).toHaveLength(0);
  });

  it("renders card rectangles from direct x/y/width/height points", () => {
    renderCanvas();
    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;

    expect(frame).toHaveStyle({
      left: "20px",
      top: "100px",
      width: "260px",
      height: "140px",
    });
  });

  it("moves a card by pointer delta instead of reordering component order", () => {
    const props = renderCanvas();
    const handlers = dndState.props as {
      onDragStart?: (event: unknown) => void;
      onDragEnd?: (event: unknown) => void;
    };
    const event = {
      active: {
        id: "plan1",
        data: { current: { type: "component", componentId: "plan1" } },
      },
      delta: { x: 50, y: -20 },
    };

    act(() => {
      handlers.onDragStart?.(event);
      handlers.onDragEnd?.(event);
    });

    expect(props.onMoveComponent).toHaveBeenCalledWith("plan1", { x: 70, y: 80 });
  });

  it("keeps reference image DnD infrastructure inside the continuous card", () => {
    renderCanvas();
    expect(document.querySelector('[data-image-group-droppable-id]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
  });
});
