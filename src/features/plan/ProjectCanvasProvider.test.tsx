import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    components: Array<{ id: string; type: string; html?: string }>;
    onMoveComponent: (id: string, toIndex: number) => void;
    onChangeHtml: (id: string, html: string) => void;
  }) => (
    <div data-testid="plan-canvas">
      <div data-testid="component-count">{components.length}</div>
      {components.map((c) =>
        c.type === "plan" ? (
          <div key={c.id} data-testid={`plan-${c.id}`}>
            {c.html}
          </div>
        ) : null,
      )}
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
    schemaVersion: 3,
    components: [
      {
        id: "plan-1",
        type: "plan",
        width: 1,
        height: 220,
        html: "<h2>Demo</h2>",
      },
      {
        id: "ref-1",
        type: "reference",
        width: 1,
        height: 320,
        title: "Lookbook",
        description: "Warm mood",
        showCaptions: false, imageHeight: 180, images: [{ id: "i1", file: "references/0001.png", aspectRatio: 1 }],
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
              { id: "i1", file: "references/0001.png", aspectRatio: 1 },
              { id: "i2", file: "references/0002.png", aspectRatio: 1 },
            ],
          } as never,
        ],
      },
      image: { id: "i2", file: "references/0002.png", aspectRatio: 1 },
      dataUrl: "data:image/png;base64,BB",
    }),
    importImages: vi.fn(),
    removeImage: vi.fn(),
    removeComponent: vi.fn(),
  };
  const pick = vi.fn().mockResolvedValue(String.raw`C:\src\b.png`);
  return {
    service,
    savePlan,
    dependencies: {
      service,
      picker: {
        pickImageFile: pick,
        pickImageFiles: vi.fn().mockResolvedValue([]),
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exporter: { export: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
      saver: { save: vi.fn().mockResolvedValue(true) },
      reveal: { reveal: vi.fn() },
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

  it("seeds an empty project with plan + reference components (plan on top)", async () => {
    const { dependencies, service } = deps();
    // Override loadPlan to return an empty plan
    (service.loadPlan as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaVersion: 3,
      components: [],
    });

    render(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    // Wait for canvas to render
    await screen.findByTestId("plan-canvas");
    
    // Should have exactly 2 components
    expect(await screen.findByTestId("component-count")).toHaveTextContent("2");
    
    // The first component should be a plan component with the template
    const canvas = screen.getByTestId("plan-canvas");
    expect(canvas.textContent).toContain("拍摄时间");
    expect(canvas.textContent).toContain("拍摄地点");
    expect(canvas.textContent).toContain("道具和服装");
    expect(canvas.textContent).toContain("器材");
    
    // Should be marked as saved (seeding doesn't count as unsaved)
    expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");
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

  it("seeds a new plan component with the default Chinese template", async () => {
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

    await user.click(screen.getByRole("button", { name: "插入组件" }));
    await user.click(screen.getByRole("menuitem", { name: "摄影计划" }));

    // After insert, the component count should be 3
    await waitFor(() => expect(screen.getByTestId("component-count")).toHaveTextContent("3"));

    // After waitFor the canvas rerender, check that the i18n template content exists in the HTML
    // The plan contains the template with all four sections
    const canvas = screen.getByTestId("plan-canvas");
    expect(canvas.textContent).toContain("拍摄时间");
    expect(canvas.textContent).toContain("拍摄地点");
    expect(canvas.textContent).toContain("道具和服装");
    expect(canvas.textContent).toContain("器材");
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

  it("auto-saves changed plan state every 5 seconds and reflects the save status", async () => {
    vi.useFakeTimers();
    try {
      const { dependencies, savePlan } = deps();

      render(
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="Demo"
          projectPath={String.raw`C:\demo`}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");

      // An edit updates in-memory state but is not persisted yet.
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(savePlan).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("有未保存的更改");

      // The 5s auto-save flushes the change exactly once and returns to "saved".
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(savePlan).toHaveBeenCalledTimes(1);
      expect(savePlan.mock.calls[0][1].components.find((c: { id: string }) => c.id === "plan-1")).toMatchObject({
        html: "<p>edited</p>",
      });
      expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");

      // With no further change, the next tick writes nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(savePlan).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

