// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult } from "../../../domain/plan/canvas/naming";
import { ComponentFrame } from "./ComponentFrame";

const dndState = vi.hoisted(() => ({
  onPointerDown: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  useDroppable: () => ({ setNodeRef: () => undefined }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { role: "button" },
    listeners: { onPointerDown: dndState.onPointerDown },
    setNodeRef: () => undefined,
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

const component: PlanComponent = {
  id: "plan1",
  name: "Plan",
  type: "plan",
  x: 40,
  width: 200,
  height: 120,
  textRoot: { kind: "leaf", id: "plan1:root", html: "<p>Shot list</p>" },
};

const referenceComponent: PlanComponent = {
  id: "reference1",
  name: "Reference",
  type: "reference",
  x: 40,
  width: 200,
  height: 120,
  description: "",
  images: [],
};

function successfulRename(): RenameComponentResult {
  return { ok: true, plan: { schemaVersion: 10, title: "", components: [] } };
}

function renderFrame(
  onResize = vi.fn(),
  onRename = vi.fn(successfulRename),
  frameComponent = component,
  scale = 1,
) {
  render(
    <DndContext>
      <ComponentFrame
        component={frameComponent}
        id={frameComponent.id}
        onRemove={vi.fn()}
        onRename={onRename}
        onResize={onResize}
        rect={{ ...frameComponent, y: 80 }}
        scale={scale}
      >
        <div>content</div>
      </ComponentFrame>
    </DndContext>,
  );
  return { onResize, onRename };
}

describe("ComponentFrame", () => {
  beforeEach(() => {
    dndState.onPointerDown.mockReset();
  });

  it("uses direct card coordinates without page-margin offsets", () => {
    renderFrame();
    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    expect(frame).toHaveStyle({ left: "40px", top: "80px", width: "200px", height: "120px" });
  });

  it("keeps plan close chrome inside the top-right corner at every canvas scale", () => {
    renderFrame(vi.fn(), vi.fn(successfulRename), component, 0.72);
    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    const body = frame.querySelector('[data-component-frame-body]') as HTMLElement;
    const close = screen.getByRole("button", { name: "移除组件" });

    expect(Number.parseFloat(frame.style.padding)).toBeCloseTo(3.6, 5);
    expect(Number.parseFloat(body.style.height)).toBeCloseTo(77.76, 5);
    expect(frame.querySelector("[data-component-frame-header]")).not.toBeInTheDocument();
    expect(close).toHaveStyle({
      position: "absolute",
      right: "-9px",
      top: "-9px",
      width: "18px",
      height: "18px",
    });
  });

  it("renders arrow movement controls without a component drag handle", () => {
    renderFrame();
    expect(screen.queryByRole("button", { name: "拖动以移动或交换位置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上移一个位置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下移一个位置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除组件" })).toHaveClass(
      "bg-[#25272b]",
      "text-white",
      "hover:bg-paper-danger",
    );
    expect(screen.getByRole("button", { name: "移除组件" })).toHaveStyle({
      width: "18px",
      height: "18px",
    });
    expect(document.querySelector("[data-component-drag-handle]")).not.toBeInTheDocument();
    expect(document.querySelector('[data-component-move-controls="plan1"]')).toHaveClass(
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
    );
    expect(screen.getByRole("button", { name: "上移一个位置" })).toHaveTextContent("上移");
    expect(screen.getByRole("button", { name: "下移一个位置" })).toHaveTextContent("下移");
    expect(document.querySelector('[data-component-move-controls="plan1"]')).toHaveStyle({
      left: "18px",
    });
    expect(screen.getByRole("button", { name: "上移一个位置" })).toHaveStyle({
      width: "20px",
      height: "17px",
    });
    expect(document.querySelector("[data-component-frame-topbar]")).not.toBeInTheDocument();
    for (const edge of ["left", "right", "top", "bottom"]) {
      expect(document.querySelector(`[data-resize-handle="${edge}"]`)).toBeInTheDocument();
    }
  });

  it("moves one position through explicit arrow callbacks", () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <DndContext>
        <ComponentFrame
          component={component}
          id={component.id}
          onMoveDown={onMoveDown}
          onMoveUp={onMoveUp}
          onRemove={vi.fn()}
          onRename={vi.fn(successfulRename)}
          onResize={vi.fn()}
          rect={{ ...component, y: 80 }}
          scale={1}
        />
      </DndContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: "上移一个位置" }));
    fireEvent.click(screen.getByRole("button", { name: "下移一个位置" }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it("commits an independently resized card rectangle", () => {
    const { onResize } = renderFrame();
    const bottom = document.querySelector('[data-resize-handle="bottom"]') as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    bottom.setPointerCapture = vi.fn();
    bottom.hasPointerCapture = vi.fn().mockReturnValue(true);
    bottom.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(bottom, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(bottom, { clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(bottom, { pointerId: 1 });

    expect(onResize).toHaveBeenCalledWith("plan1", {
      x: 40,
      y: 80,
      width: 200,
      height: 170,
    }, "bottom");

  });

  it("uses immediate natural height while horizontally previewing a plan resize", () => {
    renderFrame();
    const right = document.querySelector('[data-resize-handle="right"]') as HTMLElement & {
      setPointerCapture(pointerId: number): void;
    };
    right.setPointerCapture = vi.fn();

    fireEvent.pointerDown(right, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 160, pointerId: 1 });

    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    const body = frame.querySelector('[data-component-frame-body]') as HTMLElement;
    expect(frame).toHaveStyle({ height: "auto" });
    expect(body).toHaveStyle({ height: "auto" });
  });

  it("anchors the opposing side for left, right, top, and bottom resizes", () => {
    const { onResize } = renderFrame();
    const drag = (
      edge: "left" | "right" | "top" | "bottom",
      start: Record<string, number>,
      end: Record<string, number>,
    ) => {
      const handle = document.querySelector(
        `[data-resize-handle="${edge}"]`,
      ) as HTMLElement & {
        setPointerCapture(pointerId: number): void;
        hasPointerCapture(pointerId: number): boolean;
        releasePointerCapture(pointerId: number): void;
      };
      handle.setPointerCapture = vi.fn();
      handle.hasPointerCapture = vi.fn().mockReturnValue(true);
      handle.releasePointerCapture = vi.fn();
      fireEvent.pointerDown(handle, { ...start, pointerId: 1 });
      fireEvent.pointerMove(handle, { ...end, pointerId: 1 });
      fireEvent.pointerUp(handle, { ...end, pointerId: 1 });
    };

    drag("left", { clientX: 100 }, { clientX: 130 });
    drag("right", { clientX: 100 }, { clientX: 130 });
    drag("top", { clientY: 100 }, { clientY: 130 });
    drag("bottom", { clientY: 100 }, { clientY: 130 });

    expect(onResize).toHaveBeenNthCalledWith(1, "plan1", {
      x: 70,
      y: 80,
      width: 170,
      height: 120,
    }, "left");
    expect(onResize).toHaveBeenNthCalledWith(2, "plan1", {
      x: 40,
      y: 80,
      width: 230,
      height: 120,
    }, "right");
    expect(onResize).toHaveBeenNthCalledWith(3, "plan1", {
      x: 40,
      y: 110,
      width: 200,
      height: 90,
    }, "top");
    expect(onResize).toHaveBeenNthCalledWith(4, "plan1", {
      x: 40,
      y: 80,
      width: 200,
      height: 150,
    }, "bottom");
  });

  it("commits an editable component name", async () => {
    const { onRename } = renderFrame(
      vi.fn(),
      vi.fn(successfulRename),
      referenceComponent,
    );
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "组件名称" });
    await user.clear(input);
    await user.type(input, "NewPlan");
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("reference1", "NewPlan");
  });
});
