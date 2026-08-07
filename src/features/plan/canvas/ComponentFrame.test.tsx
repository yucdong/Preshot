// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult } from "../../../domain/plan/canvas/naming";
import { ComponentFrame } from "./ComponentFrame";

const component: PlanComponent = {
  id: "plan1",
  name: "Plan",
  type: "plan",
  x: 40,
  y: 80,
  width: 200,
  height: 120,
  html: "<p>Shot list</p>",
};

function successfulRename(): RenameComponentResult {
  return { ok: true, plan: { schemaVersion: 7, title: "", components: [] } };
}

function renderFrame(onResize = vi.fn(), onRename = vi.fn(successfulRename)) {
  render(
    <DndContext>
      <ComponentFrame
        component={component}
        id={component.id}
        onRemove={vi.fn()}
        onRename={onRename}
        onResize={onResize}
        rect={component}
        scale={1}
      >
        <div>content</div>
      </ComponentFrame>
    </DndContext>,
  );
  return { onResize, onRename };
}

describe("ComponentFrame", () => {
  it("uses direct card coordinates without page-margin offsets", () => {
    renderFrame();
    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    expect(frame).toHaveStyle({ left: "40px", top: "80px", width: "200px", height: "120px" });
  });

  it("renders an accessible move handle and all independent resize edges", () => {
    renderFrame();
    expect(screen.getByRole("button", { name: "拖动以移动或交换位置" })).toBeInTheDocument();
    for (const edge of ["left", "right", "top", "bottom"]) {
      expect(document.querySelector(`[data-resize-handle="${edge}"]`)).toBeInTheDocument();
    }
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
    });
  });

  it("commits an editable component name", async () => {
    const { onRename } = renderFrame();
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "组件名称" });
    await user.clear(input);
    await user.type(input, "NewPlan");
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("plan1", "NewPlan");
  });
});
