import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import { EMPTY_PLAN, type ProjectPlan } from "../../domain/plan/canvas/models";
import { ProjectCanvasProvider, type CanvasPlanDependencies } from "./ProjectCanvasProvider";
import { ThemeProvider } from "../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../domain/settings/ports";

// Minimal fake repository for tests
const fakeRepository: SettingsRepository = {
  read: async () => ({ theme: "system" }),
  write: async () => {},
};

vi.mock("./canvas/PlanCanvas", () => ({
  PlanCanvas: ({
    components,
    measurements,
    onMoveComponent,
    onChangeHtml,
    onResize,
    onRemoveComponent,
    onMeasurePlan,
    onMeasureReferenceDescription,
  }: {
    components: Array<{ id: string; type: string; html?: string }>;
    measurements: {
      planHeights: ReadonlyMap<string, number>;
      referenceDescriptionHeights: ReadonlyMap<string, number>;
    };
    onMoveComponent: (id: string, toIndex: number) => void;
    onChangeHtml: (id: string, html: string) => void;
    onResize: (id: string, params: { width: number }) => void;
    onRemoveComponent: (id: string) => void;
    onMeasurePlan: (
      id: string,
      measurement: { heightPoints: number; pageBreakBeforeBlockIds: string[] },
    ) => void;
    onMeasureReferenceDescription: (id: string, heightPoints: number) => void;
  }) => {
    latestPlanCanvasProps = {
      onMeasurePlan,
      onMeasureReferenceDescription,
      onChangeHtml,
      onMoveComponent,
      onRemoveComponent,
    };

    return (
      <div data-testid="plan-canvas">
        <div data-testid="component-count">{components.length}</div>
        <div data-testid="component-order">{components.map((component) => component.id).join(",")}</div>
        <div data-testid="plan-height">{measurements.planHeights.get("plan-1") ?? "none"}</div>
        <div data-testid="reference-description-height">
          {measurements.referenceDescriptionHeights.get("ref-1") ?? "none"}
        </div>
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
        <button onClick={() => onMoveComponent("plan-1", 0)} type="button">
          Move noop
        </button>
        <button onClick={() => onResize("plan-1", { width: 0.5 })} type="button">
          Resize
        </button>
        <button onClick={() => onRemoveComponent("missing")} type="button">
          Async noop
        </button>
        <button onClick={() => onRemoveComponent("ref-1")} type="button">
          Remove reference
        </button>
        <button
          onClick={() =>
            onMeasurePlan("plan-1", {
              heightPoints: 321.5,
              pageBreakBeforeBlockIds: ["plan-1:block-1"],
            })
          }
          type="button"
        >
          Measure plan
        </button>
        <button onClick={() => onMeasureReferenceDescription("ref-1", 64)} type="button">
          Measure description
        </button>
      </div>
    );
  },
}));

let latestPlanCanvasProps:
  | {
      onMeasurePlan: (
        id: string,
        measurement: { heightPoints: number; pageBreakBeforeBlockIds: string[] },
      ) => void;
      onMeasureReferenceDescription: (id: string, heightPoints: number) => void;
      onChangeHtml: (id: string, html: string) => void;
      onMoveComponent: (id: string, toIndex: number) => void;
      onRemoveComponent: (id: string) => void;
    }
  | null = null;

function deps(): {
  dependencies: CanvasPlanDependencies;
  service: CanvasPlanService;
  loadPlan: ReturnType<typeof vi.fn>;
  savePlan: ReturnType<typeof vi.fn>;
} {
  const plan: ProjectPlan = {
    schemaVersion: 5,
    title: "Demo",
    components: [
      {
        id: "plan-1",
        rowId: `row:${"plan-1"}`,
        name: "文案1",
        type: "plan",
        width: 1,
        html: "<h2>Demo</h2>",
      },
      {
        id: "ref-1",
        rowId: `row:${"ref-1"}`,
        type: "reference",
        width: 1,
        name: "Lookbook",
        description: "Warm mood",
        showCaptions: false, imageHeight: 180, images: [{ id: "i1", file: "references/0001.png", aspectRatio: 1 }],
      },
    ],
  };
  const loadPlan = vi.fn<CanvasPlanService["loadPlan"]>().mockResolvedValue({
    status: "loaded",
    plan,
  });
  const savePlan = vi.fn().mockResolvedValue(undefined);
  const service: CanvasPlanService = {
    loadPlan,
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    savePlan,
    importImage: vi.fn().mockResolvedValue({
      plan: {
        ...plan,
        components: [
          ...plan.components.slice(0, 1),
          {
            id: "ref-1",
            rowId: `row:${"ref-1"}`,
            type: "reference",
            width: 1,
            name: "Lookbook",
            description: "Warm mood",
            showCaptions: false,
            imageHeight: 180,
            images: [
              { id: "i1", file: "references/0001.png", aspectRatio: 1 },
              { id: "i2", file: "references/0002.png", aspectRatio: 1 },
            ],
          },
        ],
      },
      image: { id: "i2", file: "references/0002.png", aspectRatio: 1 },
      dataUrl: "data:image/png;base64,BB",
    }),
    importImages: vi.fn(),
    removeImage: vi.fn(async (_projectPath, currentPlan) => currentPlan),
    removeComponent: vi.fn(async (_projectPath, currentPlan) => currentPlan),
  };
  const pick = vi.fn().mockResolvedValue(String.raw`C:\src\b.png`);
  return {
    service,
    loadPlan,
    savePlan,
    dependencies: {
      service,
      picker: {
        pickImageFile: pick,
        pickImageFiles: vi.fn().mockResolvedValue([]),
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exporter: { export: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
      saver: { save: vi.fn().mockResolvedValue(null) },
      reveal: { reveal: vi.fn() },
    },
  };
}

// Helper to wrap components in ThemeProvider for testing
function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider repository={fakeRepository}>{ui}</ThemeProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installDeferredImageDecode(width: number, height: number) {
  const decoding = deferred<void>();
  const decode = vi.fn(() => decoding.promise);

  vi.stubGlobal(
    "Image",
    class MockImage {
      src = "";
      naturalWidth = width;
      naturalHeight = height;
      decode = decode;
    },
  );

  return { ...decoding, decode };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectCanvasProvider", () => {
  it("loads the plan and images", async () => {
    const { dependencies, service } = deps();

    renderWithTheme(
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

  it("waits for every expected reference image before exporting", async () => {
    const { dependencies, loadPlan, service } = deps();
    const firstImage = deferred<string>();
    const secondImage = deferred<string>();
    const exportMock = vi.mocked(dependencies.exporter.export);
    const saveMock = vi.mocked(dependencies.saver.save);
    loadPlan.mockResolvedValue({
      status: "loaded",
      plan: {
        schemaVersion: 5,
        title: "Demo",
        components: [
          {
            id: "ref-1",
            rowId: `row:${"ref-1"}`,
            type: "reference",
            width: 1,
            name: "Lookbook",
            description: "",
            showCaptions: false,
            imageHeight: 180,
            images: [
              {
                id: "i1",
                file: "references/0001.png",
                aspectRatio: 1,
              },
              {
                id: "i2",
                file: "references/0002.png",
                aspectRatio: 1,
              },
            ],
          },
        ],
      },
    });
    vi.mocked(service.loadImage).mockImplementation(
      async (_projectPath, file) => {
        if (file === "references/0001.png") {
          return firstImage.promise;
        }
        if (file === "references/0002.png") {
          return secondImage.promise;
        }
        throw new Error(`unexpected file ${file}`);
      },
    );

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(exportMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();

    await act(async () => {
      firstImage.resolve("data:image/png;base64,AA");
    });
    expect(exportMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();

    await act(async () => {
      secondImage.resolve("data:image/png;base64,BB");
    });

    await waitFor(() =>
      expect(exportMock).toHaveBeenCalledWith(
        expect.objectContaining({ schemaVersion: 5 }),
        {
          "references/0001.png": "data:image/png;base64,AA",
          "references/0002.png": "data:image/png;base64,BB",
        },
      ),
    );
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("aborts export and surfaces file context when a required image cannot load", async () => {
    const { dependencies, service } = deps();
    const exportMock = vi.mocked(dependencies.exporter.export);
    const saveMock = vi.mocked(dependencies.saver.save);
    vi.mocked(service.loadImage).mockRejectedValue(
      new Error("reference file is unavailable"),
    );

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );
    await screen.findByTestId("plan-canvas");

    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));

    expect(
      await screen.findByText(
        'Unable to export the PDF: failed to load reference image "references/0001.png": reference file is unavailable',
      ),
    ).toBeInTheDocument();
    expect(exportMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("seeds a missing project with plan + reference components (plan on top)", async () => {
    const { dependencies, loadPlan } = deps();
    loadPlan.mockResolvedValue({ status: "missing" });

    renderWithTheme(
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

  it("opens a stored empty v4 plan without seeding defaults", async () => {
    const { dependencies, loadPlan } = deps();
    loadPlan.mockResolvedValue({
      status: "loaded",
      plan: EMPTY_PLAN,
    });

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    expect(await screen.findByTestId("component-count")).toHaveTextContent("0");
    expect(screen.queryByText("拍摄时间")).not.toBeInTheDocument();
    expect(dependencies.logger.error).not.toHaveBeenCalled();
  });

  it("shows a contextual load error without auto-saving replacement data", async () => {
    vi.useFakeTimers();
    try {
      const { dependencies, loadPlan, savePlan } = deps();
      loadPlan.mockRejectedValue(
        new Error(
          "Unable to load the project plan: Unsupported stored plan schema version 5",
        ),
      );

      renderWithTheme(
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="Demo"
          projectPath={String.raw`C:\demo`}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        screen.getByText(
          "Unable to load the project plan: Unsupported stored plan schema version 5",
        ),
      ).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(savePlan).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps loading and failed projects non-editable and blocks save shortcuts", async () => {
    const { dependencies, loadPlan, savePlan } = deps();
    const loading = deferred<Awaited<ReturnType<CanvasPlanService["loadPlan"]>>>();
    loadPlan.mockReturnValue(loading.promise);

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    expect(screen.queryByTestId("plan-canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入组件" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeDisabled();

    await act(async () => {
      loading.reject(
        new Error(
          "Unable to load the project plan: Unsupported stored plan schema version 5",
        ),
      );
    });

    expect(
      await screen.findByText(
        "Unable to load the project plan: Unsupported stored plan schema version 5",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("plan-canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入组件" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(savePlan).not.toHaveBeenCalled();
  });

  it("ignores a stale load result after the project path changes", async () => {
    const { dependencies, loadPlan } = deps();
    const oldLoad = deferred<Awaited<ReturnType<CanvasPlanService["loadPlan"]>>>();
    const newPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "new-plan",
          rowId: `row:${"new-plan"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>new project</p>",
        },
      ],
    };
    const oldPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "old-plan",
          rowId: `row:${"old-plan"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>old project</p>",
        },
      ],
    };
    loadPlan.mockImplementation((path) =>
      path === String.raw`C:\old`
        ? oldLoad.promise
        : Promise.resolve({ status: "loaded", plan: newPlan }),
    );

    const { rerender } = renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Old"
        projectPath={String.raw`C:\old`}
      />,
    );

    rerender(
      <ThemeProvider repository={fakeRepository}>
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="New"
          projectPath={String.raw`C:\new`}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByTestId("plan-new-plan")).toHaveTextContent("new project");

    await act(async () => {
      oldLoad.resolve({ status: "loaded", plan: oldPlan });
    });

    expect(screen.getByTestId("plan-new-plan")).toHaveTextContent("new project");
    expect(screen.queryByTestId("plan-old-plan")).not.toBeInTheDocument();
  });

  it("flushes the dirty old project snapshot before the replacement project finishes loading", async () => {
    const { dependencies, loadPlan, savePlan } = deps();
    const newLoad = deferred<Awaited<ReturnType<CanvasPlanService["loadPlan"]>>>();
    const oldPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "plan-1",
          rowId: `row:${"plan-1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>old project</p>",
        },
      ],
    };
    const newPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "new-plan",
          rowId: `row:${"new-plan"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>new project</p>",
        },
      ],
    };
    loadPlan.mockImplementation((path) =>
      path === String.raw`C:\old`
        ? Promise.resolve({ status: "loaded", plan: oldPlan })
        : newLoad.promise,
    );

    const { rerender } = renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Old"
        projectPath={String.raw`C:\old`}
      />,
    );

    await screen.findByTestId("plan-plan-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    rerender(
      <ThemeProvider repository={fakeRepository}>
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="New"
          projectPath={String.raw`C:\new`}
        />
      </ThemeProvider>,
    );

    expect(savePlan).toHaveBeenCalledTimes(1);
    expect(savePlan).toHaveBeenCalledWith(
      String.raw`C:\old`,
      expect.objectContaining({
        components: [
          expect.objectContaining({
            id: "plan-1",
            html: "<p>edited</p>",
          }),
        ],
      }),
    );
    expect(loadPlan).toHaveBeenCalledWith(String.raw`C:\new`);

    await act(async () => {
      newLoad.resolve({ status: "loaded", plan: newPlan });
    });
    expect(await screen.findByTestId("plan-new-plan")).toHaveTextContent("new project");
  });

  it("waits for an in-flight old-project removal before flushing its latest snapshot", async () => {
    const { dependencies, loadPlan, savePlan, service } = deps();
    const removalPersisted = deferred<void>();
    const deletedFiles: string[] = [];
    const oldPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "plan-1",
          rowId: `row:${"plan-1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>old project</p>",
        },
        {
          id: "ref-1",
          rowId: `row:${"ref-1"}`,
          type: "reference",
          width: 1,
          name: "Old reference",
          description: "",
          showCaptions: false,
          imageHeight: 135,
          images: [
            {
              id: "old-image",
              file: "references/old.png",
              aspectRatio: 1,
            },
          ],
        },
      ],
    };
    const newPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "new-plan",
          rowId: `row:${"new-plan"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>new project</p>",
        },
      ],
    };
    loadPlan.mockImplementation((path) =>
      Promise.resolve({
        status: "loaded",
        plan: path === String.raw`C:\old` ? oldPlan : newPlan,
      }),
    );
    vi.mocked(service.removeComponent).mockImplementation(
      async (_path, currentPlan, componentId) => {
        const next = {
          ...currentPlan,
          components: currentPlan.components.filter(
            (component) => component.id !== componentId,
          ),
        };
        await removalPersisted.promise;
        deletedFiles.push("references/old.png");
        return next;
      },
    );
    savePlan.mockRejectedValueOnce(new Error("old retirement save failed"));

    const { rerender } = renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Old"
        projectPath={String.raw`C:\old`}
      />,
    );

    await screen.findByTestId("plan-plan-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove reference" }));
    await waitFor(() => expect(service.removeComponent).toHaveBeenCalledTimes(1));

    rerender(
      <ThemeProvider repository={fakeRepository}>
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="New"
          projectPath={String.raw`C:\new`}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByTestId("plan-new-plan")).toHaveTextContent("new project");
    expect(savePlan).not.toHaveBeenCalled();

    await act(async () => {
      removalPersisted.resolve();
    });

    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    expect(savePlan.mock.calls[0][0]).toBe(String.raw`C:\old`);
    const retiredPlan = savePlan.mock.calls[0][1] as ProjectPlan;
    expect(retiredPlan.components).toEqual([
      expect.objectContaining({
        id: "plan-1",
        html: "<p>edited</p>",
      }),
    ]);
    expect(deletedFiles).toEqual(["references/old.png"]);
    expect(screen.getByTestId("plan-new-plan")).toHaveTextContent("new project");
    expect(screen.getByTestId("component-count")).toHaveTextContent("1");
    expect(screen.queryByText("old retirement save failed")).not.toBeInTheDocument();
  });

  it("does not flush the old project on a path switch when its snapshot is clean", async () => {
    const { dependencies, loadPlan, savePlan } = deps();
    const newLoad = deferred<Awaited<ReturnType<CanvasPlanService["loadPlan"]>>>();
    const newPlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "new-plan",
          rowId: `row:${"new-plan"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>new project</p>",
        },
      ],
    };
    loadPlan.mockImplementation((path) =>
      path === String.raw`C:\old`
        ? Promise.resolve({
            status: "loaded",
            plan: {
              schemaVersion: 5,
              title: "Demo",
              components: [
                {
                  id: "plan-1",
                  rowId: `row:${"plan-1"}`,
                  name: "文案1",
                  type: "plan",
                  width: 1,
                  html: "<p>old project</p>",
                },
              ],
            },
          })
        : newLoad.promise,
    );

    const { rerender } = renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Old"
        projectPath={String.raw`C:\old`}
      />,
    );

    await screen.findByTestId("plan-plan-1");
    rerender(
      <ThemeProvider repository={fakeRepository}>
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="New"
          projectPath={String.raw`C:\new`}
        />
      </ThemeProvider>,
    );

    expect(savePlan).not.toHaveBeenCalled();

    await act(async () => {
      newLoad.resolve({ status: "loaded", plan: newPlan });
    });
    expect(await screen.findByTestId("plan-new-plan")).toHaveTextContent("new project");
  });

  it("marks unsaved when a component is edited", async () => {
    const { dependencies } = deps();

    renderWithTheme(
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

    renderWithTheme(
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

    renderWithTheme(
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

    renderWithTheme(
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

      renderWithTheme(
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

  it("backfills every shared file reference without history and persists it on flush", async () => {
    const { dependencies, loadPlan, savePlan, service } = deps();
    const imageDecode = installDeferredImageDecode(200, 100);
    const sharedFilePlan: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "ref-a",
          rowId: `row:${"ref-a"}`,
          type: "reference",
          width: 1,
          name: "A",
          description: "",
          showCaptions: false,
          imageHeight: 180,
          images: [
            { id: "i1", file: "references/shared.png", aspectRatio: 1 },
          ],
        },
        {
          id: "ref-b",
          rowId: `row:${"ref-b"}`,
          type: "reference",
          width: 1,
          name: "B",
          description: "",
          showCaptions: false,
          imageHeight: 180,
          images: [
            { id: "i2", file: "references/shared.png", aspectRatio: 1 },
          ],
        },
      ],
    };
    loadPlan.mockResolvedValue({ status: "loaded", plan: sharedFilePlan });
    vi.mocked(service.loadImage).mockResolvedValue("data:image/png;base64,shared");

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    await waitFor(() => expect(imageDecode.decode).toHaveBeenCalledTimes(1));

    await act(async () => {
      imageDecode.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("有未保存的更改"),
    );
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    const savedPlan = savePlan.mock.calls[0][1] as ProjectPlan;
    const ratios = savedPlan.components.flatMap((component) =>
      component.type === "reference"
        ? component.images.map((image) => image.aspectRatio)
        : [],
    );
    expect(ratios).toEqual([2, 2]);
    expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");
  });

  it("rebases delayed aspect backfill onto concurrent text and structural edits", async () => {
    const { dependencies, loadPlan, service } = deps();
    const imageDecode = installDeferredImageDecode(300, 100);
    const planWithImage: ProjectPlan = {
      schemaVersion: 5,
      title: "Demo",
      components: [
        {
          id: "plan-1",
          rowId: `row:${"plan-1"}`,
          name: "文案1",
          type: "plan",
          width: 1,
          html: "<p>original</p>",
        },
        {
          id: "ref-1",
          rowId: `row:${"ref-1"}`,
          type: "reference",
          width: 1,
          name: "Lookbook",
          description: "",
          showCaptions: false,
          imageHeight: 180,
          images: [
            { id: "i1", file: "references/0001.png", aspectRatio: 1 },
          ],
        },
      ],
    };
    loadPlan.mockResolvedValue({ status: "loaded", plan: planWithImage });
    vi.mocked(service.loadImage).mockResolvedValue("data:image/png;base64,delayed");

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    await waitFor(() => expect(imageDecode.decode).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "插入组件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "摄影计划" }));
    expect(screen.getByTestId("component-count")).toHaveTextContent("3");

    await act(async () => {
      imageDecode.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("component-count")).toHaveTextContent("3"),
    );
    expect(screen.getByTestId("plan-plan-1")).toHaveTextContent("edited");
  });

  it("skips history and save-state changes for a no-op structural mutation", async () => {
    const { dependencies, savePlan } = deps();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Move noop" }));

    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(savePlan).not.toHaveBeenCalled();
  });

  it("skips history and state application when an async structural result is unchanged", async () => {
    const { dependencies, service } = deps();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Async noop" }));

    await waitFor(() => expect(service.removeComponent).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");
  });

  it("keeps runtime layout measurements outside save state and undo history", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Measure plan" }));
    await user.click(screen.getByRole("button", { name: "Measure description" }));

    expect(screen.getByTestId("plan-height")).toHaveTextContent("321.5");
    expect(screen.getByTestId("reference-description-height")).toHaveTextContent("64");
    expect(screen.getByRole("status")).toHaveTextContent("已保存所有更改");
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
  });

  it("resets runtime layout measurements when the project path changes", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    const { rerender } = renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    await user.click(screen.getByRole("button", { name: "Measure plan" }));
    await user.click(screen.getByRole("button", { name: "Measure description" }));

    expect(screen.getByTestId("plan-height")).toHaveTextContent("321.5");
    expect(screen.getByTestId("reference-description-height")).toHaveTextContent("64");

    rerender(
      <ThemeProvider repository={fakeRepository}>
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="Demo"
          projectPath={String.raw`C:\other`}
        />
      </ThemeProvider>,
    );

    await screen.findByTestId("plan-canvas");
    expect(screen.getByTestId("plan-height")).toHaveTextContent("none");
    expect(screen.getByTestId("reference-description-height")).toHaveTextContent("none");
  });

  it("ignores stale measurement callbacks from the previous project after a path switch", async () => {
    const { dependencies } = deps();

    const { rerender } = renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    const staleCallbacks = latestPlanCanvasProps;

    rerender(
      <ThemeProvider repository={fakeRepository}>
        <ProjectCanvasProvider
          dependencies={dependencies}
          projectName="Demo"
          projectPath={String.raw`C:\other`}
        />
      </ThemeProvider>,
    );

    await screen.findByTestId("plan-canvas");

    act(() => {
      staleCallbacks?.onMeasurePlan("plan-1", {
        heightPoints: 999,
        pageBreakBeforeBlockIds: ["stale-block"],
      });
      staleCallbacks?.onMeasureReferenceDescription("ref-1", 111);
    });

    expect(screen.getByTestId("plan-height")).toHaveTextContent("none");
    expect(screen.getByTestId("reference-description-height")).toHaveTextContent("none");
  });
});

describe("ProjectCanvasProvider undo/redo", () => {
  it("undoes a structural move and preserves current editor text", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");

    // Edit text (no history) then perform a structural move.
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Move" }));

    const undoButton = screen.getByRole("button", { name: "撤销" });
    expect(undoButton).toBeEnabled();

    await user.click(undoButton);

    // The edited html ("<p>edited</p>") is preserved across the structural undo.
    expect(screen.getByTestId("plan-plan-1")).toHaveTextContent("edited");
    // Undo consumed the only entry; redo is now available.
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重做" })).toBeEnabled();
  });

  it("does not create an undo entry for a text-only change", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
  });

  it("coalesces a resize burst into a single undo entry", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");

    // Two synchronous same-target resizes share a sub-millisecond timestamp, so
    // they coalesce deterministically into a single undo entry.
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));

    await user.click(screen.getByRole("button", { name: "撤销" }));

    // A single undo empties the stack (the burst was one entry).
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
  });

  it("Ctrl+Z triggers global undo when no text editor is focused", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");

    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "重做" })).toBeEnabled();
  });

  it("Ctrl+Z is ignored while a contenteditable is focused", async () => {
    const { dependencies } = deps();
    const user = userEvent.setup();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");

    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    editable.focus();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    // BlockNote would own this Ctrl+Z; global undo did NOT fire.
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();

    editable.remove();
  });

  it("disables undo and redo on a freshly loaded project", async () => {
    const { dependencies } = deps();

    renderWithTheme(
      <ProjectCanvasProvider
        dependencies={dependencies}
        projectName="Demo"
        projectPath={String.raw`C:\demo`}
      />,
    );

    await screen.findByTestId("plan-canvas");
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重做" })).toBeDisabled();
  });
});
