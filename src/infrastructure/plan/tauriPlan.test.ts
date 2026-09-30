import { describe, expect, it, vi } from "vitest";
import { createTauriPlan } from "./tauriPlan";
import { createEmptyProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";

describe("createTauriPlan", () => {
  it("streams large originals in bounded chunks and resolves an uncertain finish with the same receipt", async () => {
    const saved = { file: "media/original.png", name: "original.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" };
    let finishes = 0;
    const invokeCommand = vi.fn(async (command: string, _args?: Record<string, unknown>) => {
      if (command === "finish_image_import") {
        if (++finishes === 1) throw new Error("reply lost after publication");
        return saved;
      }
      return null;
    });
    const chunk = new Uint8Array(2 * 1024 * 1024 + 1);
    async function* chunks() { yield chunk; }
    const native = createTauriPlan({ invokeCommand });
    await expect(native.importImageStream!("C:\\p", "original.png", chunk.length, chunks())).resolves.toEqual(saved);
    const writes = invokeCommand.mock.calls.filter(([command]) => command === "append_image_import");
    expect(writes.map(([, args]) => args!.offset)).toEqual([0, 1024 * 1024, 2 * 1024 * 1024]);
    expect(writes.every(([, args]) => (args!.bytes as number[]).length <= 1024 * 1024)).toBe(true);
    const receipts = invokeCommand.mock.calls.filter(([command]) => command === "finish_image_import");
    expect(receipts[0][1]).toEqual(receipts[1][1]);
    expect(invokeCommand.mock.calls.some(([command]) => command === "abort_image_import")).toBe(false);
  });

  it("aborts owned partial uploads and reports cleanup failure after a cancelled source", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "abort_image_import") throw new Error("disk unavailable during cleanup");
      return null;
    });
    async function* chunks() { yield new Uint8Array([1, 2]); throw new Error("Import cancelled"); }
    await expect(createTauriPlan({ invokeCommand }).importImageStream!("C:\\p", "original.png", 300_000_000, chunks()))
      .rejects.toThrow(/cleanup.*disk unavailable/);
    expect(invokeCommand.mock.calls.some(([command]) => command === "finish_image_import")).toBe(false);
  });

  it("validates clipboard file receipts, status and retained history results", async () => {
    const operationId = "paste-operation";
    const input = { projectPath: "C:\\p", operationId, destination: "references" as const,
      expectedPlan: createEmptyProjectPlanV15("P", { makeId: () => "paragraph" }), image: { name: "image.png", mimeType: "image/png", bytes: [1] } };
    const invokeCommand = vi.fn()
      .mockResolvedValueOnce({ operationId, file: "references/0002.png", name: "image.png", mimeType: "image/png" })
      .mockResolvedValueOnce({ status: "committed" })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce({ operationId, file: "..\\other.png", name: "image.png", mimeType: "image/png" })
      .mockResolvedValueOnce({ status: "anything" });
    const plan = createTauriPlan({ invokeCommand });
    await expect(plan.prepareImagePaste(input)).resolves.toMatchObject({ file: "references/0002.png" });
    expect(invokeCommand).toHaveBeenCalledWith("prepare_image_paste", input);
    await expect(plan.getImagePasteStatus("C:\\p", operationId)).resolves.toBe("committed");
    await expect(plan.isImageRetainedForHistory!("C:\\p", "references/0002.png")).resolves.toBe(true);
    await expect(plan.isImageRetainedForHistory!("C:\\p", "references/0002.png")).rejects.toThrow();
    await expect(plan.prepareImagePaste(input)).rejects.toThrow();
    await expect(plan.getImagePasteStatus("C:\\p", operationId)).rejects.toThrow();
  });

  it("distinguishes removed references from copies retained for material history", async () => {
    const invokeCommand = vi.fn()
      .mockResolvedValueOnce("retainedForMaterialHistory")
      .mockResolvedValueOnce("removed")
      .mockResolvedValueOnce(null);
    const plan = createTauriPlan({ invokeCommand });
    await expect(plan.removeImage("C:\\p", "references/0001.png")).resolves.toBe("retainedForMaterialHistory");
    await expect(plan.removeImage("C:\\p", "references/0002.png")).resolves.toBe("removed");
    await expect(plan.removeImage("C:\\p", "references/0003.png")).rejects.toThrow("Malformed native response");
  });

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

  it("shapes copy-on-write crop arguments and validates the new image", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      file: "references/0002.png",
      dataUrl: "data:image/png;base64,BB",
      width: 320,
      height: 240,
    });
    const plan = createTauriPlan({ invokeCommand });
    if (!plan.copyImageCrop) throw new Error("Copy crop store is unavailable");

    await expect(plan.copyImageCrop("C:\\p", {
      file: "references/0001.png",
      bounds: { x: 10, y: 20, width: 320, height: 240 },
    })).resolves.toEqual({
      file: "references/0002.png",
      dataUrl: "data:image/png;base64,BB",
      width: 320,
      height: 240,
    });
    expect(invokeCommand).toHaveBeenCalledWith("copy_reference_image_crop", {
      projectPath: "C:\\p",
      file: "references/0001.png",
      bounds: { x: 10, y: 20, width: 320, height: 240 },
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
