import { describe, expect, it, vi } from "vitest";
import { createTauriPlan } from "./tauriPlan";

describe("createTauriPlan", () => {
  it("imports an image and validates the response", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({ file: "references/0001.jpg", dataUrl: "data:image/jpeg;base64,AA" });
    const plan = createTauriPlan({ invokeCommand });

    const result = await plan.importImage("C:\\p", "C:\\src\\a.jpg");

    expect(invokeCommand).toHaveBeenCalledWith("import_reference_image", { projectPath: "C:\\p", sourcePath: "C:\\src\\a.jpg" });
    expect(result).toEqual({ file: "references/0001.jpg", dataUrl: "data:image/jpeg;base64,AA" });
  });

  it("wraps native failures with operation context", async () => {
    const invokeCommand = vi.fn().mockRejectedValue({ message: "boom" });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.savePlan("C:\\p", { referenceGroups: [] })).rejects.toThrow(
      /Unable to save the project plan: boom/,
    );
  });

  it("reads and validates a plan", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      referenceGroups: [{ id: "g1", title: "L", description: "Warm tones", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.jpg" }] }],
    });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.loadPlan("C:\\p")).resolves.toEqual({
      referenceGroups: [{ id: "g1", title: "L", description: "Warm tones", columnsPerRow: 3, images: [{ id: "i1", file: "references/0001.jpg" }] }],
    });
  });

  it("defaults a missing description to an empty string", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      referenceGroups: [{ id: "g1", title: "L", columnsPerRow: 3, images: [] }],
    });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.loadPlan("C:\\p")).resolves.toEqual({
      referenceGroups: [{ id: "g1", title: "L", description: "", columnsPerRow: 3, images: [] }],
    });
  });
});
