import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLogger } from "../workspace/ports";
import { EMPTY_PLAN } from "./models";
import { addGroup, createGroup } from "./plan";
import type { PlanRepository, ReferenceImageStore } from "./ports";
import { createPlanService } from "./service";

function logger(): WorkspaceLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function deps() {
  const repository: PlanRepository = {
    loadPlan: vi.fn().mockResolvedValue(EMPTY_PLAN),
    savePlan: vi.fn().mockResolvedValue(undefined),
  };
  const imageStore: ReferenceImageStore = {
    importImage: vi.fn().mockResolvedValue({ file: "references/0001.jpg", dataUrl: "data:image/jpeg;base64,AA" }),
    loadImage: vi.fn().mockResolvedValue("data:image/png;base64,BB"),
    removeImage: vi.fn().mockResolvedValue(undefined),
  };
  let counter = 0;
  const createId = () => `id-${(counter += 1)}`;
  return { repository, imageStore, createId, logger: logger() };
}

describe("createPlanService", () => {
  it("adds a group, persists it, and returns the next plan", async () => {
    const d = deps();
    const service = createPlanService(d);

    const next = await service.addGroup("C:\\p", EMPTY_PLAN, "Lookbook");

    expect(next.referenceGroups).toHaveLength(1);
    expect(next.referenceGroups[0]).toMatchObject({ id: "id-1", title: "Lookbook", columnsPerRow: 3 });
    expect(d.repository.savePlan).toHaveBeenCalledWith("C:\\p", next);
  });

  it("imports an image into a group, persists, and returns its data URL", async () => {
    const d = deps();
    const service = createPlanService(d);
    const base = addGroup(EMPTY_PLAN, createGroup("g1", "Lookbook", 3));

    const result = await service.importImage("C:\\p", base, "g1", "C:\\src\\a.jpg");

    expect(d.imageStore.importImage).toHaveBeenCalledWith("C:\\p", "C:\\src\\a.jpg");
    expect(result.image).toEqual({ id: "id-1", file: "references/0001.jpg" });
    expect(result.dataUrl).toBe("data:image/jpeg;base64,AA");
    expect(result.plan.referenceGroups[0].images).toEqual([{ id: "id-1", file: "references/0001.jpg" }]);
    expect(d.repository.savePlan).toHaveBeenCalledWith("C:\\p", result.plan);
  });

  it("removes an image: persists the new plan before deleting the file", async () => {
    const d = deps();
    const order: string[] = [];
    vi.mocked(d.repository.savePlan).mockImplementation(async () => { order.push("save"); });
    vi.mocked(d.imageStore.removeImage).mockImplementation(async () => { order.push("delete"); });
    const service = createPlanService(d);
    const base = { referenceGroups: [{ id: "g1", title: "L", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.jpg" }] }] };

    const next = await service.removeImage("C:\\p", base, "g1", "i1");

    expect(next.referenceGroups[0].images).toEqual([]);
    expect(d.imageStore.removeImage).toHaveBeenCalledWith("C:\\p", "references/0001.jpg");
    expect(order).toEqual(["save", "delete"]);
  });

  it("wraps repository failures with operation context", async () => {
    const d = deps();
    vi.mocked(d.repository.savePlan).mockRejectedValueOnce(new Error("disk full"));
    const service = createPlanService(d);

    await expect(service.addGroup("C:\\p", EMPTY_PLAN, "L")).rejects.toThrow(
      /Unable to save the project plan: disk full/,
    );
  });
});
