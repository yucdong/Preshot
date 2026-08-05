import { act, render, screen } from "@testing-library/react";
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

async function flushScheduledRecalculation() {
  await act(async () => {
    await Promise.resolve();
  });
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
  contentKey = "initial",
  onMeasure,
}: {
  contentHeightPoints: number;
  contentKey?: string;
  onMeasure: (
    id: string,
    measurement: { heightPoints: number; pageBreakBeforeBlockIds: string[] },
  ) => void;
}) {
  const { rootRef } = usePlanContentMeasurement({
    componentId: "plan-1",
    contentKey,
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

function NestedBlockGroupHarness({
  contentHeightPoints,
  contentKey = "initial",
  onMeasure,
}: {
  contentHeightPoints: number;
  contentKey?: string;
  onMeasure: (
    id: string,
    measurement: { heightPoints: number; pageBreakBeforeBlockIds: string[] },
  ) => void;
}) {
  const { rootRef } = usePlanContentMeasurement({
    componentId: "plan-1",
    contentKey,
    scale: 1,
    contentHeightPoints,
    onMeasure,
  });

  return (
    <div data-testid="paged-canvas-surface">
      <div data-testid="editor-root" ref={rootRef}>
        <div className="bn-editor">
          <div className="nested-wrapper">
            <div className="bn-block-group" data-node-type="blockGroup">
              <div className="bn-block-outer" data-node-type="blockOuter" data-testid="decoy-block">
                <div>Wrong</div>
              </div>
            </div>
          </div>
          <div className="bn-block-group" data-node-type="blockGroup">
            <div className="bn-block-outer" data-node-type="blockOuter" data-testid="top-block-1">
              <div>First</div>
            </div>
            <div className="bn-block-outer" data-node-type="blockOuter" data-testid="top-block-2">
              <div>Second</div>
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

  it("recalculates when the rendered BlockNote content key changes without a resize callback", async () => {
    const onMeasure = vi.fn();
    const { container, rerender } = render(
      <MeasurementHarness contentHeightPoints={200} contentKey="before" onMeasure={onMeasure} />,
    );

    const surface = screen.getByTestId("paged-canvas-surface");
    const root = screen.getByTestId("editor-root");
    const blockGroup = container.querySelector('[data-node-type="blockGroup"]');
    const initialBlocks = container.querySelectorAll('[data-node-type="blockOuter"]');

    expect(blockGroup).not.toBeNull();

    setRect(surface, { top: 0, bottom: 2000, height: 2000 });
    setRect(root, { top: 0, bottom: 200, height: 200 });
    setRect(initialBlocks[0], { top: 0, bottom: 60, height: 60 });
    setRect(initialBlocks[1], { top: 60, bottom: 200, height: 140 });
    onMeasure.mockClear();

    emitResize([{ target: root, contentRect: { height: 200 } as DOMRectReadOnly }]);
    expect(initialBlocks[1]).not.toHaveClass("bn-page-break-before");

    blockGroup!.innerHTML = `
      <div class="bn-block-outer" data-node-type="blockOuter"><div>First</div></div>
      <div class="bn-block-outer" data-node-type="blockOuter"><div>Second</div></div>
    `;

    const replacementBlocks = container.querySelectorAll('[data-node-type="blockOuter"]');
    setRect(replacementBlocks[0], { top: 700, bottom: 760, height: 60 });
    setRect(replacementBlocks[1], { top: 760, bottom: 900, height: 140 });
    onMeasure.mockClear();

    rerender(<MeasurementHarness contentHeightPoints={200} contentKey="after" onMeasure={onMeasure} />);
    await flushScheduledRecalculation();

    expect(onMeasure).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        pageBreakBeforeBlockIds: ["plan-1:block-1"],
      }),
    );
    expect(onMeasure.mock.calls.at(-1)?.[1].heightPoints).toBeCloseTo(321.89, 2);
    expect(replacementBlocks[1]).toHaveClass("bn-page-break-before");
  });

  it("uses the top-level block group instead of a nested descendant", () => {
    const onMeasure = vi.fn();
    render(<NestedBlockGroupHarness contentHeightPoints={200} onMeasure={onMeasure} />);

    const surface = screen.getByTestId("paged-canvas-surface");
    const root = screen.getByTestId("editor-root");
    const decoyBlock = screen.getByTestId("decoy-block");
    const topBlock1 = screen.getByTestId("top-block-1");
    const topBlock2 = screen.getByTestId("top-block-2");

    setRect(surface, { top: 0, bottom: 2000, height: 2000 });
    setRect(root, { top: 700, bottom: 900, height: 200 });
    setRect(decoyBlock, { top: 0, bottom: 40, height: 40 });
    setRect(topBlock1, { top: 700, bottom: 760, height: 60 });
    setRect(topBlock2, { top: 760, bottom: 900, height: 140 });
    onMeasure.mockClear();

    emitResize([{ target: root, contentRect: { height: 200 } as DOMRectReadOnly }]);

    expect(onMeasure).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        pageBreakBeforeBlockIds: ["plan-1:block-1"],
      }),
    );
    expect(topBlock2).toHaveClass("bn-page-break-before");
    expect(topBlock2).toHaveAttribute("data-preshot-block-id", "plan-1:block-1");
    expect(decoyBlock).not.toHaveAttribute("data-preshot-block-id");
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

    const observer = ResizeObserverMock.instances[0];
    const disconnectCallsBeforeUnmount = observer.disconnect.mock.calls.length;
    unmount();

    expect(observer.disconnect.mock.calls.length).toBe(disconnectCallsBeforeUnmount + 1);
    expect(blocks[1]).not.toHaveClass("bn-page-break-before");
    expect(blocks[1]).not.toHaveAttribute("data-preshot-block-id");
    expect((blocks[1] as HTMLElement).style.getPropertyValue("--bn-page-break-space")).toBe("");
  });

  it("observes top-level blocks without observing the editor root itself", () => {
    const onMeasure = vi.fn();
    const { container } = render(
      <MeasurementHarness contentHeightPoints={200} onMeasure={onMeasure} />,
    );

    const root = screen.getByTestId("editor-root");
    const blocks = container.querySelectorAll('[data-node-type="blockOuter"]');
    const observer = ResizeObserverMock.instances[0];
    const observedTargets = observer.observe.mock.calls.map(([target]) => target);

    expect(observedTargets).not.toContain(root);
    expect(observedTargets).toContain(blocks[0]);
    expect(observedTargets).toContain(blocks[1]);
  });
});
