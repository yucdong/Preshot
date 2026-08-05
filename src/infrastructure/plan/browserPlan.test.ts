import { describe, expect, it } from "vitest";
import { createBrowserCanvasPlanDependencies } from "./browserPlan";

describe("createBrowserCanvasPlanDependencies", () => {
  it("seeds a canvas plan with components and picker returns deterministic path", async () => {
    const { service, picker } = createBrowserCanvasPlanDependencies();

    const plan = await service.loadPlan("C:\\demo");
    expect(plan.components).toHaveLength(2);
    expect(await picker.pickImageFile("Pick")).toBe("C:\\memory\\import.png");
  });

  it("assigns imported images file ids after the seeded demo images", async () => {
    const { service } = createBrowserCanvasPlanDependencies();
    const imported = await service.importImage("C:\\demo", await service.loadPlan("C:\\demo"), "ref-1", "C:\\x\\new.png");

    expect(imported.image.file).toBe("references/0005.png");
  });
});
