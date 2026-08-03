import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanRepository, ReferenceImageStore } from "../../domain/plan/ports";
import { createPlanService, type PlanService } from "../../domain/plan/service";
import { ProjectPlanProvider, type PlanDependencies } from "./ProjectPlanProvider";

vi.mock("./RichTextEditor", () => ({
  RichTextEditor: ({ html, onChange, ariaLabel, placeholder }: {
    html: string;
    onChange(html: string): void;
    ariaLabel: string;
    placeholder?: string;
    compact?: boolean;
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={html}
    />
  ),
}));

function deps(): { dependencies: PlanDependencies; service: PlanService; pick: ReturnType<typeof vi.fn> } {
  const plan = { photographyPlan: "", referenceGroups: [{ id: "g1", title: "Lookbook", description: "Warm editorial mood", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] }] };
  const service: PlanService = {
    loadPlan: vi.fn().mockResolvedValue(plan),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    savePlan: vi.fn().mockResolvedValue(undefined),
    addGroup: vi.fn(),
    renameGroup: vi.fn(),
    setDescription: vi.fn(),
    setPhotographyPlan: vi.fn(),
    deleteGroup: vi.fn(),
    setColumns: vi.fn(),
    moveImage: vi.fn(),
    importImage: vi.fn().mockResolvedValue({
      plan: { photographyPlan: "", referenceGroups: [{ id: "g1", title: "Lookbook", description: "Warm editorial mood", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }, { id: "i2", file: "references/0002.png" }] }] },
      image: { id: "i2", file: "references/0002.png" },
      dataUrl: "data:image/png;base64,BB",
    }),
    removeImage: vi.fn(),
  };
  const pick = vi.fn().mockResolvedValue(String.raw`C:\src\b.png`);
  return {
    service,
    pick,
    dependencies: {
      service,
      picker: { pickImageFile: pick },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exporter: { export: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
      saver: { save: vi.fn().mockResolvedValue(true) },
    },
  };
}

function autoSaveDeps() {
  const savePlan = vi.fn().mockResolvedValue(undefined);
  const repository: PlanRepository = {
    loadPlan: vi.fn().mockResolvedValue({
      photographyPlan: "",
      referenceGroups: [{ id: "g1", title: "Lookbook", description: "", columnsPerRow: 3, images: [] }],
    }),
    savePlan,
  };
  const imageStore: ReferenceImageStore = {
    importImage: vi.fn(),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    removeImage: vi.fn(),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = createPlanService({ repository, imageStore, createId: () => "id", logger });
  const dependencies: PlanDependencies = {
    service,
    picker: { pickImageFile: vi.fn() },
    logger,
    exporter: { export: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) },
    saver: { save: vi.fn().mockResolvedValue(true) },
  };
  return { savePlan, dependencies };
}

describe("ProjectPlanProvider", () => {
  it("loads the plan and images, then imports and opens the lightbox", async () => {
    const user = userEvent.setup();
    const { dependencies, service } = deps();

    render(<ProjectPlanProvider dependencies={dependencies} projectName="Demo" projectPath={String.raw`C:\demo`} />);

    const group = await screen.findByRole("group", { name: "Reference group: Lookbook" });
    expect(service.loadImage).toHaveBeenCalledWith(String.raw`C:\demo`, "references/0001.png");
    expect(await screen.findByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(within(group).getByRole("button", { name: "Add reference image" }));
    await waitFor(() => expect(service.importImage).toHaveBeenCalledWith(String.raw`C:\demo`, expect.anything(), "g1", String.raw`C:\src\b.png`));
    expect(await screen.findByRole("img", { name: "Reference image 2" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open reference image 1" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("auto-saves changed plan state every 5 seconds and reflects the save status", async () => {
    vi.useFakeTimers();
    try {
      const { savePlan, dependencies } = autoSaveDeps();

      render(<ProjectPlanProvider dependencies={dependencies} projectName="Demo" projectPath={String.raw`C:\demo`} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("save-status")).toHaveTextContent("已保存所有更改");

      // A pure-metadata edit updates in-memory state but is not persisted yet.
      fireEvent.change(screen.getByRole("combobox", { name: "Images per row" }), {
        target: { value: "4" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(savePlan).not.toHaveBeenCalled();
      expect(screen.getByTestId("save-status")).toHaveTextContent("有未保存的更改");

      // The 5s auto-save flushes the change exactly once and returns to "saved".
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(savePlan).toHaveBeenCalledTimes(1);
      expect(savePlan.mock.calls[0][1].referenceGroups[0].columnsPerRow).toBe(4);
      expect(screen.getByTestId("save-status")).toHaveTextContent("已保存所有更改");

      // With no further change, the next tick writes nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(savePlan).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes pending changes immediately on Ctrl+S", async () => {
    vi.useFakeTimers();
    try {
      const { savePlan, dependencies } = autoSaveDeps();

      render(<ProjectPlanProvider dependencies={dependencies} projectName="Demo" projectPath={String.raw`C:\demo`} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      fireEvent.change(screen.getByRole("combobox", { name: "Images per row" }), {
        target: { value: "5" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(savePlan).not.toHaveBeenCalled();

      // Ctrl+S saves now, without waiting for the 5s interval.
      await act(async () => {
        fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(savePlan).toHaveBeenCalledTimes(1);
      expect(savePlan.mock.calls[0][1].referenceGroups[0].columnsPerRow).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports the plan to pdf and saves it", async () => {
    const user = userEvent.setup();
    const { dependencies } = deps();
    render(<ProjectPlanProvider dependencies={dependencies} projectName="Sunset" projectPath={String.raw`C:\demo`} />);

    await screen.findByRole("group", { name: "Reference group: Lookbook" });
    await user.click(screen.getByRole("button", { name: "导出 PDF" }));

    await waitFor(() => expect(dependencies.exporter.export).toHaveBeenCalled());
    await waitFor(() => expect(dependencies.saver.save).toHaveBeenCalledWith(expect.any(Uint8Array), String.raw`C:\demo\output.pdf`));
  });
});
