import { describe, expect, it } from "vitest";
import { createBrowserPlanDependencies } from "./browserPlan";

describe("createBrowserPlanDependencies", () => {
  it("seeds one group of two images and imports deterministically", async () => {
    const { service, picker } = createBrowserPlanDependencies();

    const plan = await service.loadPlan("C:\\demo");
    expect(plan.referenceGroups[0].images).toHaveLength(2);
    expect(await picker.pickImageFile("Pick")).toBe("C:\\memory\\import.png");

    const result = await service.importImage("C:\\demo", plan, "seed-group", "C:\\memory\\import.png");
    expect(result.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(result.plan.referenceGroups[0].images).toHaveLength(3);
  });
});
