import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculatePlanPageBreaks,
  usePlanContentMeasurement,
} from "./usePlanContentMeasurement";

type ResizeObserverEntryLike = Pick<ResizeObserverEntry, "target" | "contentRect">;

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  callback: ResizeObserverCallback;
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
}

function emitResize(entries: ResizeObserverEntryLike[]) {
  for (const instance of ResizeObserverMock.instances) {
    instance.callback(
      entries.map(
        (entry) =>
          ({
            target: entry.target,
            contentRect: entry.contentRect,
          }) as ResizeObserverEntry,
      ),
      instance as unknown as ResizeObserver,
    );
  }
}

function setRect(element: Element, rect: Partial<DOMRect>) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        top: 0,
        right: 100,
        bottom: 0,
        left: 0,
        toJSON() {
          return this;
        },
        ...rect,
      }) satisfies DOMRect,
  });
}

function MeasurementHarness({
  contentHeightPoints,
  onMeasure,
}: {
  contentHeightPoints: number;
  onMeasure: (
    id: string,
    measurement: { heightPoints: number; pageBreakBeforeBlockIds: string[] },
  ) => void;
}) {
  const { rootRef } = usePlanContentMeasurement({
    componentId: "plan-1",
    scale: 1,
    contentHeightPoints,
    onMeasure,
  });

  return (
    <div data-testid="paged-canvas-surface">
      <div data-component-frame="true">
        <div data-testid="editor-root" ref={rootRef}>
          <div className="bn-editor">
            <div className="bn-block-group" data-node-type="blockGroup">
              <div className="bn-block-outer" data-node-type="blockOuter">
                <div>First</div>
              </div>
              <div className="bn-block-outer" data-node-type="blockOuter">
                <div>Second</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

describe("calculatePlanPageBreaks", () => {
  it("marks the first whole block that would cross a page boundary", () => {
    const result = calculatePlanPageBreaks({
      blocks: [
        { id: "a", top: 0, bottom: 200 },
        { id: "b", top: 200, bottom: 430 },
      ],
      pageContentHeightPoints: 400,
      pageMarginPoints: 0,
      pageSurfaceHeightPoints: 400,
    });

    expect(result.pageBreakBeforeBlockIds).toEqual(["b"]);
  });
});

describe("usePlanContentMeasurement", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    ResizeObserverMock.instances = [];
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("adds runtime page-break metadata without rewriting editor html", () => {
    const onMeasure = vi.fn();
    const { container } = render(
      <MeasurementHarness contentHeightPoints={200} onMeasure={onMeasure} />,
    );

    const surface = screen.getByTestId("paged-canvas-surface");
    const root = screen.getByTestId("editor-root");
    const blocks = container.querySelectorAll('[data-node-type="blockOuter"]');

    setRect(surface, { top: 0, bottom: 2000, height: 2000 });
    setRect(root, { top: 700, bottom: 900, height: 200 });
    setRect(blocks[0], { top: 700, bottom: 760, height: 60 });
    setRect(blocks[1], { top: 760, bottom: 900, height: 140 });
    onMeasure.mockClear();

    emitResize([{ target: root, contentRect: { height: 200 } as DOMRectReadOnly }]);

    expect(onMeasure).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        pageBreakBeforeBlockIds: ["plan-1:block-1"],
      }),
    );
    expect(onMeasure.mock.calls.at(-1)?.[1].heightPoints).toBeCloseTo(321.89, 2);
    expect(blocks[1]).toHaveClass("bn-page-break-before");
    expect(blocks[1]).toHaveAttribute("data-preshot-block-id", "plan-1:block-1");
    expect(container.querySelector(".bn-block-group")?.innerHTML).toContain("First");
    expect(container.querySelector(".bn-block-group")?.innerHTML).toContain("Second");
  });

  it("cleans runtime classes and properties on unmount", () => {
    const onMeasure = vi.fn();
    const { container, unmount } = render(
      <MeasurementHarness contentHeightPoints={200} onMeasure={onMeasure} />,
    );

    const surface = screen.getByTestId("paged-canvas-surface");
    const root = screen.getByTestId("editor-root");
    const blocks = container.querySelectorAll('[data-node-type="blockOuter"]');

    setRect(surface, { top: 0, bottom: 2000, height: 2000 });
    setRect(root, { top: 700, bottom: 900, height: 200 });
    setRect(blocks[0], { top: 700, bottom: 760, height: 60 });
    setRect(blocks[1], { top: 760, bottom: 900, height: 140 });

    emitResize([{ target: root, contentRect: { height: 200 } as DOMRectReadOnly }]);

    unmount();

    expect(blocks[1]).not.toHaveClass("bn-page-break-before");
    expect(blocks[1]).not.toHaveAttribute("data-preshot-block-id");
    expect((blocks[1] as HTMLElement).style.getPropertyValue("--bn-page-break-space")).toBe("");
  });
});
