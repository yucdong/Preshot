import { DndContext } from "@dnd-kit/core";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Rect } from "../../../domain/plan/canvas/geometry";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { ComponentFrame } from "./ComponentFrame";

const component: PlanComponent = {
  id: "plan1",
  type: "plan",
  width: 0.5,
  html: "<p>拍摄清单</p>",
};

const rect: Rect = { x: 0, y: 0, width: 200, height: 120 };

function renderFrame(onResize = vi.fn()) {
  render(
    <DndContext>
      <ComponentFrame
        component={component}
        contentWidthPoints={500}
        id={component.id}
        onRemove={vi.fn()}
        onResize={onResize}
        rect={rect}
        scale={1}
      >
        <div>content</div>
      </ComponentFrame>
    </DndContext>,
  );

  const widthHandle = document.querySelector('[data-resize-handle="width"]') as HTMLElement & {
    hasPointerCapture(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
    setPointerCapture(pointerId: number): void;
  };

  widthHandle.setPointerCapture = vi.fn();
  widthHandle.releasePointerCapture = vi.fn();
  widthHandle.hasPointerCapture = vi.fn().mockReturnValue(true);

  return { onResize, widthHandle };
}

describe("ComponentFrame", () => {
  it("releases pointer capture on pointerup even when no resize preview exists", () => {
    const { onResize, widthHandle } = renderFrame();

    fireEvent.pointerDown(widthHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(widthHandle, { pointerId: 1 });

    expect(widthHandle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does not commit resize after pointercancel", () => {
    const { onResize, widthHandle } = renderFrame();

    fireEvent.pointerDown(widthHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(widthHandle, { clientX: 260, pointerId: 1 });
    fireEvent.pointerCancel(widthHandle, { pointerId: 1 });
    fireEvent.pointerUp(widthHandle, { pointerId: 1 });

    expect(widthHandle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("does not commit resize after lostpointercapture", () => {
    const { onResize, widthHandle } = renderFrame();

    fireEvent.pointerDown(widthHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(widthHandle, { clientX: 260, pointerId: 1 });
    fireEvent(widthHandle, new Event("lostpointercapture", { bubbles: true }));
    fireEvent.pointerUp(widthHandle, { pointerId: 1 });

    expect(widthHandle.releasePointerCapture).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });
});
