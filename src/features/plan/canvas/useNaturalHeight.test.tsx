import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNaturalHeight } from "./useNaturalHeight";

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

function emitResize(entry: ResizeObserverEntryLike) {
  for (const instance of ResizeObserverMock.instances) {
    instance.callback(
      [
        {
          target: entry.target,
          contentRect: entry.contentRect,
        } as ResizeObserverEntry,
      ],
      instance as unknown as ResizeObserver,
    );
  }
}

function NaturalHeightHarness({
  scale,
  onHeight,
}: {
  scale: number;
  onHeight: (id: string, heightPoints: number) => void;
}) {
  const ref = useNaturalHeight({ id: "p", scale, onHeight });
  return <div data-testid="root" ref={ref} />;
}

describe("useNaturalHeight", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    ResizeObserverMock.instances = [];
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("reports natural height in A4 points and ignores sub-one-point jitter", () => {
    const onHeight = vi.fn();
    render(<NaturalHeightHarness onHeight={onHeight} scale={0.5} />);

    const root = screen.getByTestId("root");
    emitResize({
      target: root,
      contentRect: { height: 100 } as DOMRectReadOnly,
    });

    expect(onHeight).toHaveBeenCalledWith("p", 200);

    emitResize({
      target: root,
      contentRect: { height: 100.2 } as DOMRectReadOnly,
    });

    expect(onHeight).toHaveBeenCalledTimes(1);
  });

  it("guards non-finite measurements and disconnects observers on unmount", () => {
    const onHeight = vi.fn();
    const { unmount } = render(<NaturalHeightHarness onHeight={onHeight} scale={0} />);

    const root = screen.getByTestId("root");
    emitResize({
      target: root,
      contentRect: { height: 100 } as DOMRectReadOnly,
    });

    expect(onHeight).not.toHaveBeenCalled();

    const instance = ResizeObserverMock.instances[0];
    unmount();

    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });
});
