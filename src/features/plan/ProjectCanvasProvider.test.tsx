// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { ProjectCanvasProvider, type CanvasPlanDependencies } from "./ProjectCanvasProvider";

const canvasState = vi.hoisted(() => ({
  props: null as {
    components: ProjectPlan["components"];
    onMoveComponent?: (id: string, target: { x: number; y: number }) => void;
    onResize?: (
      id: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => void;
  } | null,
}));

vi.mock("./canvas/PlanCanvas", () => ({
  PlanCanvas: ({
    components,
    onMoveComponent,
    onResize,
  }: {
    components: ProjectPlan["components"];
    onMoveComponent?: (id: string, target: { x: number; y: number }) => void;
    onResize?: (
      id: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => void;
  }) => {
    canvasState.props = { components, onMoveComponent, onResize };
    return (
      <div data-testid="plan-canvas">
        <div data-testid="component-ids">{components.map((component) => component.id).join(",")}</div>
        <button
          onClick={() => onMoveComponent?.("plan-1", { x: 180, y: 210 })}
          type="button"
        >
          Move card
        </button>
        <button
          onClick={() =>
            onResize?.("plan-1", { x: 180, y: 210, width: 240, height: 180 })
          }
          type="button"
        >
          Resize card
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
  schemaVersion: 7,
  title: "Demo",
  components: [{
    id: "plan-1",
    name: "Plan",
    type: "plan",
    x: 0,
    y: 60,
    width: 300,
    height: 220,
    html: "<p>Demo</p>",
  }],
};

function dependencies() {
  const savePlan = vi.fn<CanvasPlanService["savePlan"]>().mockResolvedValue(undefined);
  const service: CanvasPlanService = {
    loadPlan: vi.fn().mockResolvedValue({ status: "loaded", plan: initialPlan }),
    savePlan,
    loadImage: vi.fn(),
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

describe("ProjectCanvasProvider v7 cards", () => {
  beforeEach(() => {
    canvasState.props = null;
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inserts a deterministic non-overlapping card below existing cards", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "Insert plan" }));
    await waitFor(() => expect(canvasState.props?.components).toHaveLength(2));
    const inserted = canvasState.props!.components[1];
    expect(inserted).toMatchObject({
      x: 0,
      y: 304,
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

  it("persists direct move and resize rectangles without changing component order", async () => {
    const { savePlan } = renderProvider();
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "Move card" }));
    await waitFor(() =>
      expect(canvasState.props?.components[0]).toMatchObject({ x: 180, y: 210 }),
    );
    await flush();
    await waitFor(() => expect(savePlan).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Resize card" }));
    await waitFor(() =>
      expect(canvasState.props?.components[0]).toMatchObject({
        id: "plan-1",
        x: 180,
        y: 210,
        width: 240,
        height: 180,
      }),
    );
    await flush();
    await waitFor(() =>
      expect(savePlan).toHaveBeenLastCalledWith(
        "C:\\project",
        expect.objectContaining({
          components: [expect.objectContaining({
            id: "plan-1",
            x: 180,
            y: 210,
            width: 240,
            height: 180,
          })],
        }),
      ),
    );
  });
});
