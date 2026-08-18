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

    await expect(plan.saveRawPlan("C:\\p", { schemaVersion: 12, title: "Demo", components: [] })).rejects.toThrow(
      /Unable to save the project plan: boom/,
    );
  });

  it("imports native media bytes and validates the response", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      file: "media/0001.mp3",
      dataUrl: "data:audio/mpeg;base64,AA",
      name: "track.mp3",
      mimeType: "audio/mpeg",
    });
    const plan = createTauriPlan({ invokeCommand });

    await expect(plan.importMedia("C:\\p", {
      name: "track.mp3",
      mimeType: "audio/mpeg",
      bytes: [1, 2, 3],
    })).resolves.toMatchObject({
      file: "media/0001.mp3",
      name: "track.mp3",
      mimeType: "audio/mpeg",
    });
    expect(invokeCommand).toHaveBeenCalledWith("import_plan_media", {
      projectPath: "C:\\p",
      name: "track.mp3",
      mimeType: "audio/mpeg",
      bytes: [1, 2, 3],
    });
  });

  it("shapes crop overwrite arguments and validates dimensions", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      file: "references/0001.png",
      dataUrl: "data:image/png;base64,AA",
      width: 640,
      height: 480,
      transactionId: "crop-transaction",
    });
    const plan = createTauriPlan({ invokeCommand });

    const transaction = await plan.beginImageCrop("C:\\p", {
      file: "references/0001.png",
      bounds: { x: 10, y: 20, width: 640, height: 480 },
    });

    expect(transaction.image).toEqual({
      file: "references/0001.png",
      dataUrl: "data:image/png;base64,AA",
      width: 640,
      height: 480,
    });
    expect(invokeCommand).toHaveBeenCalledWith("crop_reference_image", {
      projectPath: "C:\\p",
      file: "references/0001.png",
      bounds: { x: 10, y: 20, width: 640, height: 480 },
    });
    await transaction.commit();
    expect(invokeCommand).toHaveBeenCalledWith("commit_reference_image_crop", {
      projectPath: "C:\\p",
      file: "references/0001.png",
      transactionId: "crop-transaction",
    });
    await transaction.rollback();
    expect(invokeCommand).toHaveBeenCalledWith("rollback_reference_image_crop", {
      projectPath: "C:\\p",
      file: "references/0001.png",
      transactionId: "crop-transaction",
    });
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
