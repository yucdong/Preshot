import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { ProjectCanvasProvider, type CanvasPlanDependencies } from "./ProjectCanvasProvider";

vi.mock("./canvas/PlanCanvas", () => ({
  PlanCanvas: ({
    components,
    onMoveComponent,
    onChangeHtml,
  }: {
    components: unknown[];
    onMoveComponent: (id: string, toIndex: number) => void;
    onChangeHtml: (id: string, html: string) => void;
  }) => (
    <div data-testid="plan-canvas">
      <div data-testid="component-count">{components.length}</div>
      <button onClick={() => onChangeHtml("plan-1", "<p>edited</p>")} type="button">
        Edit
      </button>
      <button onClick={() => onMoveComponent("plan-1", 1)} type="button">
        Move
      </button>
    </div>
  ),
}));

function deps(): {
  dependencies: CanvasPlanDependencies;
  service: CanvasPlanService;
  savePlan: ReturnType<typeof vi.fn>;
} {
  const plan: ProjectPlan = {
    schemaVersion: 2,
    components: [
      {
        id: "plan-1",
        type: "plan",
        widthFraction: "1",
        height: 220,
        html: "<h2>Demo</h2>",
      },
      {
        id: "ref-1",
        type: "reference",
        widthFraction: "1",
        height: 320,
        title: "Lookbook",
        description: "Warm mood",
        columnsPerRow: 3,
        showCaptions: false,
        images: [{ id: "i1", file: "references/0001.png" }],
      },
    ],
  };
  const savePlan = vi.fn().mockResolvedValue(undefined);
  const service: CanvasPlanService = {
    loadPlan: vi.fn().mockResolvedValue(plan),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    savePlan,
    importImage: vi.fn().mockResolvedValue({
      plan: {
        ...plan,
        components: [
          ...plan.components.slice(0, 1),
          {
            ...plan.components[1],
            images: [
              { id: "i1", file: "references/0001.png" },
              { id: "i2", file: "references/0002.png" },
            ],
          } as never,
        ],
      },
      image: { id: "i2", file: "references/0002.png" },
      dataUrl: "data:image/png;base64,BB",
    }),
    removeImage: vi.fn(),
    removeComponent: vi.fn(),
  };
  const pick = vi.fn().mockResolvedValue(String.raw`C:\src\b.png`);
  return {
    service,
    savePlan,
    dependencies: {
      service,
      picker: { pickImageFile: pick },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exporter: { export: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
      saver: { save: vi.fn().mockResolvedValue(true) },
    },
  };
}

describe("ProjectCanvasProvider", () => {
  it("loads the plan and images", async () => {
    const { dependencies, service } = deps();

    render(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await waitFor(() =>
      expect(service.loadImage).toHaveBeenCalledWith(String.raw`C:\demo`, "references/0001.png"),
    );

    expect(await screen.findByTestId("component-count")).toHaveTextContent("2");
  });

  it("marks unsaved when a component is edited", async () => {
    const { dependencies } = deps();

    render(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    expect(await screen.findByRole("status")).toHaveTextContent("已保存所有更改");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("有未保存的更改"));
  });

  it("adds a plan component when insert menu selects 'plan'", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    render(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    expect(await screen.findByTestId("component-count")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("menuitem", { name: "摄影计划" }));

    await waitFor(() => expect(screen.getByTestId("component-count")).toHaveTextContent("3"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("有未保存的更改"));
  });

  it("adds a reference component when insert menu selects 'reference'", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    render(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    expect(await screen.findByTestId("component-count")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("menuitem", { name: "参考图组" }));

    await waitFor(() => expect(screen.getByTestId("component-count")).toHaveTextContent("3"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("有未保存的更改"));
  });
});

