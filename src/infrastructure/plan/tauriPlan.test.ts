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

    await expect(plan.saveRawPlan("C:\\p", { schemaVersion: 7, title: "Demo", components: [] })).rejects.toThrow(
      /Unable to save the project plan: boom/,
    );
  });

  it("reads a raw canvas plan", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      schemaVersion: 2,
      components: [{ id: "c1", rowId: `row:${"c1"}`, name: "文案1", type: "plan", widthFraction: "1", height: 200, html: "<p>Test</p>" }],
    });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.loadRawPlan("C:\\p")).resolves.toEqual({
      schemaVersion: 2,
      components: [{ id: "c1", rowId: `row:${"c1"}`, name: "文案1", type: "plan", widthFraction: "1", height: 200, html: "<p>Test</p>" }],
    });
  });

  it("tolerates null result from Rust (returns null)", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(null);
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.loadRawPlan("C:\\p")).resolves.toBeNull();
  });
});
