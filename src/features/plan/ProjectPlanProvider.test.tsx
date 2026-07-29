import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlanService } from "../../domain/plan/service";
import { ProjectPlanProvider, type PlanDependencies } from "./ProjectPlanProvider";

function deps(): { dependencies: PlanDependencies; service: PlanService; pick: ReturnType<typeof vi.fn> } {
  const plan = { referenceGroups: [{ id: "g1", title: "Lookbook", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }] }] };
  const service: PlanService = {
    loadPlan: vi.fn().mockResolvedValue(plan),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,AA"),
    addGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    setColumns: vi.fn(),
    importImage: vi.fn().mockResolvedValue({
      plan: { referenceGroups: [{ id: "g1", title: "Lookbook", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.png" }, { id: "i2", file: "references/0002.png" }] }] },
      image: { id: "i2", file: "references/0002.png" },
      dataUrl: "data:image/png;base64,BB",
    }),
    removeImage: vi.fn(),
  };
  const pick = vi.fn().mockResolvedValue(String.raw`C:\src\b.png`);
  return {
    service,
    pick,
    dependencies: { service, picker: { pickImageFile: pick }, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
  };
}

describe("ProjectPlanProvider", () => {
  it("loads the plan and images, then imports and opens the lightbox", async () => {
    const user = userEvent.setup();
    const { dependencies, service } = deps();

    render(<ProjectPlanProvider projectPath={String.raw`C:\demo`} dependencies={dependencies} />);

    const group = await screen.findByRole("group", { name: "Reference group: Lookbook" });
    expect(service.loadImage).toHaveBeenCalledWith(String.raw`C:\demo`, "references/0001.png");
    expect(await screen.findByRole("img", { name: "Reference image 1" })).toBeVisible();

    await user.click(within(group).getByRole("button", { name: "Add reference image" }));
    await waitFor(() => expect(service.importImage).toHaveBeenCalledWith(String.raw`C:\demo`, expect.anything(), "g1", String.raw`C:\src\b.png`));
    expect(await screen.findByRole("img", { name: "Reference image 2" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Open reference image 1" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
});
