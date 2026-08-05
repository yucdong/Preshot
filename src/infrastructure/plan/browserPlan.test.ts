import { describe, expect, it } from "vitest";
import { createBrowserCanvasPlanDependencies } from "./browserPlan";

describe("createBrowserCanvasPlanDependencies", () => {
  it("seeds a canvas plan with components and picker returns deterministic path", async () => {
    const { service, picker } = createBrowserCanvasPlanDependencies();

    const result = await service.loadPlan("C:\\demo");
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    expect(result.plan.components).toHaveLength(2);
    expect(await picker.pickImageFile("Pick")).toBe("C:\\memory\\import.png");
  });

  it("assigns imported images file ids after the seeded demo images", async () => {
    const { service } = createBrowserCanvasPlanDependencies();
    const result = await service.loadPlan("C:\\demo");
    if (result.status !== "loaded") {
      throw new Error("Expected the seeded browser plan to load");
    }
    const imported = await service.importImage(
      "C:\\demo",
      result.plan,
      "ref-1",
      "C:\\x\\new.png",
    );

    expect(imported.image.file).toBe("references/0005.png");
  });
});
