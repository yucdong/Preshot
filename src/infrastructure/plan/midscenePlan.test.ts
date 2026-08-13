import { beforeEach, describe, expect, it } from "vitest";
import { createMidsceneCanvasPlanDependencies } from "./midscenePlan";

beforeEach(() => window.localStorage.clear());

describe("createMidsceneCanvasPlanDependencies", () => {
  it("starts empty and persists plans independently by project path", async () => {
    const firstPath = "C:\\Preshot Midscene Runs\\UIAUTO-A";
    const secondPath = "C:\\Preshot Midscene Runs\\UIAUTO-B";
    const dependencies = createMidsceneCanvasPlanDependencies();
    const first = await dependencies.service.loadPlan(firstPath, "UIAUTO-A");
    const second = await dependencies.service.loadPlan(secondPath, "UIAUTO-B");

    expect(first.status).toBe("loaded");
    expect(second.status).toBe("loaded");
    if (first.status !== "loaded" || second.status !== "loaded") {
      throw new Error("Expected Midscene plans to load");
    }
    expect(first.plan.components).toEqual([]);
    expect(second.plan.components).toEqual([]);

    await dependencies.service.savePlan(firstPath, { ...first.plan, title: "Only A" });

    const reloaded = createMidsceneCanvasPlanDependencies();
    await expect(reloaded.service.loadPlan(firstPath, "UIAUTO-A")).resolves.toMatchObject({
      plan: { title: "Only A" },
    });
    await expect(reloaded.service.loadPlan(secondPath, "UIAUTO-B")).resolves.toMatchObject({
      plan: { title: "未命名方案" },
    });
  });
});
