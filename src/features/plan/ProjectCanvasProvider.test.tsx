// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { ProjectCanvasProvider, type CanvasPlanDependencies } from "./ProjectCanvasProvider";

const canvasState = vi.hoisted(() => ({
  props: null as {
    components: ProjectPlan["components"];
    scale: number;
    onReorderComponent?: (id: string, toIndex: number) => void;
    onResize?: (
      id: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => void;
    onSetImageFrame?: (
      componentId: string,
      imageId: string,
      frame: { frameWidth: number; frameHeight: number },
    ) => void;
    onMeasurePlan?: (
      id: string,
      measurement: {
        heightPoints: number;
        pageBreakBeforeBlockIds: string[];
        blockHeightsPoints: number[];
        sourceHtml?: string;
        blocks?: readonly { html: string; heightPoints: number }[];
      },
    ) => void;
    onScaleReferenceImages?: (componentId: string, scale: number) => void;
  } | null,
}));

vi.mock("./canvas/PlanCanvas", () => ({
  PlanCanvas: ({
    components,
    onReorderComponent,
    onResize,
    onSetImageFrame,
    onMeasurePlan,
    onScaleReferenceImages,
    scale,
  }: {
    components: ProjectPlan["components"];
    onReorderComponent?: (id: string, toIndex: number) => void;
    onResize?: (
      id: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => void;
    onSetImageFrame?: (
      componentId: string,
      imageId: string,
      frame: { frameWidth: number; frameHeight: number },
    ) => void;
    onMeasurePlan?: (
      id: string,
      measurement: {
        heightPoints: number;
        pageBreakBeforeBlockIds: string[];
        blockHeightsPoints: number[];
        sourceHtml?: string;
        blocks?: readonly { html: string; heightPoints: number }[];
      },
    ) => void;
    onScaleReferenceImages?: (componentId: string, scale: number) => void;
    scale: number;
  }) => {
    canvasState.props = {
      components,
      onReorderComponent,
      onResize,
      onSetImageFrame,
      onMeasurePlan,
      onScaleReferenceImages,
      scale,
    };
    return (
      <div data-testid="plan-canvas">
        <div data-testid="component-ids">{components.map((component) => component.id).join(",")}</div>
        <button
          onClick={() => onReorderComponent?.("plan-1", 1)}
          type="button"
        >
          Reorder card
        </button>
        <button
          onClick={() =>
            onResize?.("plan-1", { x: 180, y: 210, width: 240, height: 180 })
          }
          type="button"
        >
          Resize card
        </button>
        <button
          onClick={() =>
            onSetImageFrame?.("reference-1", "image-1", {
              frameWidth: 240,
              frameHeight: 90,
            })
          }
          type="button"
        >
          Resize image frame
        </button>
        <button
          onClick={() => onScaleReferenceImages?.("reference-1", 0.5)}
          type="button"
        >
          Scale image group
        </button>
      </div>
    );
  },
}));

vi.mock("./canvas/CanvasToolbar", () => ({
  CanvasToolbar: ({
    onInsert,
  }: {
    onInsert: (type: "plan" | "reference") => void;
  }) => (
    <button onClick={() => onInsert("plan")} type="button">
      Insert plan
    </button>
  ),
}));

const initialPlan: ProjectPlan = {
  schemaVersion: 8,
  title: "Demo",
  components: [{
    id: "plan-1",
    name: "Plan",
    type: "plan",
    x: 0,
    width: 300,
    height: 220,
    html: "<p>Demo</p>",
  }, {
    id: "reference-1",
    name: "References",
    type: "reference",
    x: 0,
    width: 120,
    height: 80,
    description: "",
    images: [{
      id: "image-1",
      file: "references/image-1.png",
      aspectRatio: 2,
      frameWidth: 270,
      frameHeight: 135,
    }],
  }],
};

function dependencies() {
  const savePlan = vi.fn<CanvasPlanService["savePlan"]>().mockResolvedValue(undefined);
  const service: CanvasPlanService = {
    loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan: initialPlan }),
    savePlan,
    loadImage: vi.fn().mockRejectedValue(new Error("Image loading is not needed in this provider test")),
    importImage: vi.fn(),
    importImages: vi.fn(),
    removeImage: vi.fn(),
    removeComponent: vi.fn(),
  };
  const dependencies: CanvasPlanDependencies = {
    service,
    picker: {
      pickImageFile: vi.fn(),
      pickImageFiles: vi.fn(),
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    exporter: { export: vi.fn() },
    saver: { save: vi.fn() },
    reveal: { reveal: vi.fn() },
  };
  return { dependencies, savePlan };
}

function renderProvider() {
  const setup = dependencies();
  render(
    <ProjectCanvasProvider
      dependencies={setup.dependencies}
      projectName="Demo"
      projectPath={"C:\\project"}
    />,
  );
  return setup;
}

async function flush() {
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await Promise.resolve();
}

describe("ProjectCanvasProvider v8 cards", () => {
  let resizeObserverCallback: ResizeObserverCallback;

  beforeEach(() => {
    canvasState.props = null;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zooms the canvas with Ctrl+wheel while preserving normal wheel scrolling", async () => {
    renderProvider();
    await screen.findByTestId("plan-canvas");

    act(() => {
      resizeObserverCallback([{
        contentRect: { width: 476.224 },
      } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(canvasState.props?.scale).toBeCloseTo(0.8);

    const scroller = screen.getByTestId("canvas-scroller");
    const zoomIn = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });
    expect(scroller.dispatchEvent(zoomIn)).toBe(false);
    await waitFor(() => expect(canvasState.props?.scale).toBeCloseTo(0.88));

    const normalWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    expect(scroller.dispatchEvent(normalWheel)).toBe(true);
    expect(canvasState.props?.scale).toBeCloseTo(0.88);
  });

  it("persists automatic text height normalization immediately", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    act(() => {
      canvasState.props?.onMeasurePlan?.("plan-1", {
        heightPoints: 44,
        pageBreakBeforeBlockIds: [],
        blockHeightsPoints: [32],
        sourceHtml: "<p>Demo</p>",
        blocks: [{ html: "<p>Demo</p>", heightPoints: 32 }],
      });
    });

    await waitFor(() =>
      expect(savePlan).toHaveBeenCalledWith(
        "C:\\project",
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({ id: "plan-1", height: 96 }),
          ]),
        }),
      ),
    );
  });

  it("inserts a deterministic non-overlapping card below existing cards", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "Insert plan" }));
    await waitFor(() => expect(canvasState.props?.components).toHaveLength(3));
    const inserted = canvasState.props!.components[0];
    expect(inserted).toMatchObject({
      x: 0,
      width: 547.28,
      height: 220,
    });

    await flush();
    await waitFor(() =>
      expect(savePlan).toHaveBeenCalledWith(
        "C:\\project",
        expect.objectContaining({ components: expect.arrayContaining([inserted]) }),
      ),
    );
  });

  it("persists component reorder and resize as separate undoable changes", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "Reorder card" }));
    await waitFor(() =>
      expect(canvasState.props?.components.map((component) => component.id)).toEqual([
        "reference-1",
        "plan-1",
      ]),
    );
    await flush();
    await waitFor(() => expect(savePlan).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Resize card" }));
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        id: "plan-1",
        x: 180,
        width: 240,
        height: 180,
      }),
    );
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        id: "plan-1",
        x: 0,
        width: 300,
        height: 220,
      }),
    );
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(canvasState.props?.components.map((component) => component.id)).toEqual([
        "plan-1",
        "reference-1",
      ]),
    );
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        id: "plan-1",
        x: 180,
        width: 240,
        height: 180,
      }),
    );
    await flush();
    await waitFor(() =>
      expect(savePlan).toHaveBeenLastCalledWith(
        "C:\\project",
        expect.objectContaining({
          components: expect.arrayContaining([expect.objectContaining({
            id: "plan-1",
            x: 180,
            width: 240,
            height: 180,
          })]),
        }),
      ),
    );
  });

  it("records and autosaves image frame resizing through provider history", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "Resize image frame" }));
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        images: [expect.objectContaining({ frameWidth: 240, frameHeight: 90 })],
      }),
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        images: [expect.objectContaining({ frameWidth: 270, frameHeight: 135 })],
      }),
    );
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        images: [expect.objectContaining({ frameWidth: 240, frameHeight: 90 })],
      }),
    );

    await flush();
    await waitFor(() =>
      expect(savePlan).toHaveBeenLastCalledWith(
        "C:\\project",
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              id: "reference-1",
              images: [expect.objectContaining({ frameWidth: 240, frameHeight: 90 })],
            }),
          ]),
        }),
      ),
    );
  });

  it("scales a whole image group as one undoable persisted change", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "Scale image group" }));
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        images: [expect.objectContaining({ frameWidth: 135, frameHeight: 67.5 })],
      }),
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() =>
      expect(canvasState.props?.components[1]).toMatchObject({
        images: [expect.objectContaining({ frameWidth: 270, frameHeight: 135 })],
      }),
    );
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await flush();
    await waitFor(() =>
      expect(savePlan).toHaveBeenLastCalledWith(
        "C:\\project",
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              id: "reference-1",
              images: [expect.objectContaining({ frameWidth: 135, frameHeight: 67.5 })],
            }),
          ]),
        }),
      ),
    );
  });
});
