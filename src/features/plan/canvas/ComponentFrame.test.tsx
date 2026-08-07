import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  componentFrameChromeHeight,
  EDITABLE_COMPONENT_FRAME_CHROME,
  type Rect,
} from "../../../domain/plan/canvas/geometry";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import type { RenameComponentResult } from "../../../domain/plan/canvas/naming";
import { ComponentFrame } from "./ComponentFrame";
import { estimateNameInputWidthEm } from "./componentNameWidth";

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/sortable")>("@dnd-kit/sortable");

  return {
    ...actual,
    useSortable: () => ({
      attributes: { role: "button", "aria-roledescription": "sortable" },
      listeners: {},
      setNodeRef: () => undefined,
      transform: { x: 24, y: 16, scaleX: 1, scaleY: 1 },
      transition: "transform 200ms ease",
      isDragging: false,
    }),
  };
});

const component: PlanComponent = {
  id: "plan1",
  name: "文案1",
  type: "plan",
  width: 0.5,
  contentScale: 1,
  html: "<p>拍摄清单</p>",
};

const rect: Rect = { x: 0, y: 0, width: 200, height: 120 };

function renderFrame(
  onResize = vi.fn(),
  onRename: (id: string, name: string) => RenameComponentResult = vi.fn(
    (): RenameComponentResult => ({
      ok: true,
      plan: { schemaVersion: 6, title: "", components: [] },
    }),
  ),
) {
  render(
    <DndContext>
      <ComponentFrame
        component={component}
        contentWidthPoints={500}
        id={component.id}
        onRemove={vi.fn()}
        onRename={onRename}
        onResize={onResize}
        rect={rect}
        scale={1}
      >
        <div>content</div>
      </ComponentFrame>
    </DndContext>,
  );

  const widthHandle = document.querySelector('[data-resize-handle="right"]') as HTMLElement & {
    hasPointerCapture(pointerId: number): boolean;
    releasePointerCapture(pointerId: number): void;
    setPointerCapture(pointerId: number): void;
  };

  widthHandle.setPointerCapture = vi.fn();
  widthHandle.releasePointerCapture = vi.fn();
  widthHandle.hasPointerCapture = vi.fn().mockReturnValue(true);

  return { onResize, widthHandle };
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ComponentFrame", () => {
  it("renders an editable component name and commits a renamed value", async () => {
    const onRename = vi.fn<() => RenameComponentResult>(() => ({
      ok: true,
      plan: { schemaVersion: 6, title: "", components: [] },
    }));
    const user = userEvent.setup();

    renderFrame(vi.fn(), onRename);

    const input = screen.getByRole("textbox", { name: "组件名称" });
    await user.clear(input);
    await user.type(input, "Hero copy");
    await user.tab();

    expect(onRename).toHaveBeenCalledWith("plan1", "Hero copy");
  });

  it("renders an accessible drag handle for the component frame", () => {
    renderFrame();

    expect(screen.getByRole("button", { name: "拖动以移动或交换位置" })).toHaveAttribute(
      "data-component-drag-handle",
      "true",
    );
  });

  it("restores the committed name when a duplicate rename is rejected", async () => {
    const onRename = vi.fn<() => RenameComponentResult>(() => ({
      ok: false,
      reason: "duplicate",
    }));
    const user = userEvent.setup();

    renderFrame(vi.fn(), onRename);

    const input = screen.getByRole("textbox", { name: "组件名称" });
    await user.clear(input);
    await user.type(input, "Existing");
    await user.tab();

    expect(input).toHaveValue("文案1");
    expect(screen.getByRole("alert")).toHaveTextContent("组件名称不能重复");
  });

  it("resets its name draft and validation error when the committed name changes", async () => {
    const onRename = vi.fn<() => RenameComponentResult>(() => ({
      ok: false,
      reason: "duplicate",
    }));
    const user = userEvent.setup();
    const { rerender } = render(
      <DndContext>
        <ComponentFrame
          component={component}
          contentWidthPoints={500}
          id={component.id}
          onRemove={vi.fn()}
          onRename={onRename}
          onResize={vi.fn()}
          rect={rect}
          scale={1}
        >
          <div>content</div>
        </ComponentFrame>
      </DndContext>,
    );

    const input = screen.getByRole("textbox", { name: "组件名称" });
    await user.clear(input);
    await user.type(input, "Existing");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("组件名称不能重复");

    rerender(
      <DndContext>
        <ComponentFrame
          component={{ ...component, name: "拍摄文案" }}
          contentWidthPoints={500}
          id={component.id}
          onRemove={vi.fn()}
          onRename={onRename}
          onResize={vi.fn()}
          rect={rect}
          scale={1}
        >
          <div>content</div>
        </ComponentFrame>
      </DndContext>,
    );

    expect(screen.getByRole("textbox", { name: "组件名称" })).toHaveValue("拍摄文案");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores the component name on Escape", async () => {
    const user = userEvent.setup();

    renderFrame();

    const input = screen.getByRole("textbox", { name: "组件名称" });
    await user.clear(input);
    await user.type(input, "Draft");
    await user.keyboard("{Escape}");

    expect(input).toHaveValue("文案1");
  });

  it("uses the frame border and restrained body elevation", () => {
    renderFrame();

    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    expect(frame).toHaveClass("border-dashed", "border-stone-400/80", "dark:border-stone-500");
    expect(frame).toHaveClass("shadow-sm", "dark:shadow-black/30");
  });

  it("releases pointer capture on pointerup even when no resize preview exists", () => {
    const { onResize, widthHandle } = renderFrame();

    fireEvent.pointerDown(widthHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(widthHandle, { pointerId: 1 });

    expect(widthHandle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onResize).not.toHaveBeenCalled();
  });

  it.each([
    ["left", "cursor-ew-resize"],
    ["right", "cursor-ew-resize"],
    ["top", "cursor-ns-resize"],
    ["bottom", "cursor-ns-resize"],
  ] as const)("renders the %s edge as a focusable resize affordance", (edge, cursor) => {
    renderFrame();

    const handle = document.querySelector(`[data-resize-handle="${edge}"]`) as HTMLElement;
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveClass(cursor, "hover:opacity-100", "focus-visible:opacity-100");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("previews and commits proportional content scaling from the bottom edge", () => {
    const onResize = vi.fn();
    renderFrame(onResize);
    const handle = document.querySelector('[data-resize-handle="bottom"]') as HTMLElement & {
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
      setPointerCapture(pointerId: number): void;
    };
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn().mockReturnValue(true);

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(onResize).toHaveBeenCalledWith(
      "plan1",
      expect.objectContaining({ width: expect.any(Number), contentScale: expect.any(Number) }),
    );
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

  it("omits sortable transform and transition when reduced motion is preferred", () => {
    mockMatchMedia(true);

    render(
      <DndContext>
        <ComponentFrame
          component={component}
          contentWidthPoints={500}
          id={component.id}
          onRemove={vi.fn()}
          onResize={vi.fn()}
          rect={rect}
          scale={1}
        >
          <div>content</div>
        </ComponentFrame>
      </DndContext>,
    );

    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;

    expect(frame.style.transform).toBe("");
    expect(frame.style.transition).toBe("");
  });

  it("pins a source placeholder instead of applying its sortable transform", () => {
    render(
      <DndContext>
        <ComponentFrame
          component={component}
          contentWidthPoints={500}
          id={component.id}
          isPlaceholder
          onRemove={vi.fn()}
          onResize={vi.fn()}
          rect={rect}
          scale={1}
        >
          <div>content</div>
        </ComponentFrame>
      </DndContext>,
    );

    const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
    expect(frame.style.transform).toBe("");
  });

  it.each([0.5, 1.75])(
    "scales frame chrome and leaves the exact remaining body height at scale %s",
    (scale) => {
      render(
        <DndContext>
          <ComponentFrame
            component={component}
            contentWidthPoints={500}
            id={component.id}
            onRemove={vi.fn()}
            onResize={vi.fn()}
            rect={rect}
            scale={scale}
          >
            <div>content</div>
          </ComponentFrame>
        </DndContext>,
      );

      const frame = document.querySelector('[data-component-id="plan1"]') as HTMLElement;
      const topBar = frame.querySelector("[data-component-frame-topbar]") as HTMLElement;
      const body = frame.querySelector("[data-component-frame-body]") as HTMLElement;
      const chromeHeight = componentFrameChromeHeight(EDITABLE_COMPONENT_FRAME_CHROME);

      expect(topBar).not.toBeNull();
      expect(body).not.toBeNull();
      expect(topBar.style.height).toBe(
        `${EDITABLE_COMPONENT_FRAME_CHROME.topBarHeight * scale}px`,
      );
      expect(topBar.style.marginBottom).toBe(
        `${EDITABLE_COMPONENT_FRAME_CHROME.contentGap * scale}px`,
      );
      expect(body.style.height).toBe(`${(rect.height - chromeHeight) * scale}px`);
      expect(
        Number.parseFloat(topBar.style.height) +
          Number.parseFloat(topBar.style.marginBottom) +
          Number.parseFloat(body.style.height),
      ).toBeCloseTo(Number.parseFloat(frame.style.height), 5);
    },
  );

  it("sizes the component name input to its text instead of the full top bar", () => {
    renderFrame();

    const input = screen.getByRole("textbox", { name: "组件名称" });
    expect(input.style.width).toBe("4em");
    expect(input.parentElement).not.toHaveClass("flex-1");
  });

  it("allocates full-width space for every Chinese character", () => {
    expect(estimateNameInputWidthEm("小清新人像拍摄")).toBe(8);
    expect(estimateNameInputWidthEm("Lookbook 参考")).toBeGreaterThan(8);
  });
});
