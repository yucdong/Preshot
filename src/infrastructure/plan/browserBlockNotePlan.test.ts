import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowserBlockNotePlan,
  createBrowserBlockNoteImageStore,
} from "./browserBlockNotePlan";

describe("browser BlockNote image crop store", () => {
  beforeEach(() => {
    clearBrowserBlockNotePlan();
  });

  it("rewrites the same in-memory file with deterministic crop results", async () => {
    const cropper = vi.fn().mockResolvedValue(
      "data:image/png;base64,cropped",
    );
    const store = createBrowserBlockNoteImageStore(cropper);
    const imported = await store.importImage("C:\\project", "C:\\source.png");

    const transaction = await store.beginImageCrop("C:\\project", {
      file: imported.file,
      bounds: { x: 1, y: 1, width: 4, height: 3 },
    });

    expect(cropper).toHaveBeenCalledWith(imported.dataUrl, {
      x: 1,
      y: 1,
      width: 4,
      height: 3,
    });
    expect(transaction.image).toEqual({
      file: imported.file,
      dataUrl: "data:image/png;base64,cropped",
      width: 4,
      height: 3,
    });
    await transaction.commit();
    await expect(store.loadImage("C:\\project", imported.file)).resolves.toBe(
      "data:image/png;base64,cropped",
    );
  });

  it("restores the original browser image when a crop transaction rolls back", async () => {
    const store = createBrowserBlockNoteImageStore(
      vi.fn().mockResolvedValue("data:image/png;base64,cropped"),
    );
    const imported = await store.importImage("C:\\project", "C:\\source.png");

    const transaction = await store.beginImageCrop("C:\\project", {
      file: imported.file,
      bounds: { x: 1, y: 1, width: 4, height: 3 },
    });
    await transaction.rollback();

    await expect(store.loadImage("C:\\project", imported.file)).resolves.toBe(
      imported.dataUrl,
    );
  });

  it("writes a cropped copy without changing the source image", async () => {
    const cropper = vi.fn().mockResolvedValue(
      "data:image/png;base64,copied-crop",
    );
    const store = createBrowserBlockNoteImageStore(cropper);
    const imported = await store.importImage("C:\\project", "C:\\source.png");
    if (!store.copyImageCrop) throw new Error("Copy crop store is unavailable");

    const copied = await store.copyImageCrop("C:\\project", {
      file: imported.file,
      bounds: { x: 1, y: 1, width: 4, height: 3 },
    });

    expect(copied).toEqual({
      file: "references/blocknote-0002.png",
      dataUrl: "data:image/png;base64,copied-crop",
      width: 4,
      height: 3,
    });
    await expect(store.loadImage("C:\\project", imported.file)).resolves.toBe(
      imported.dataUrl,
    );
    await expect(store.loadImage("C:\\project", copied.file)).resolves.toBe(
      "data:image/png;base64,copied-crop",
    );
  });
});
