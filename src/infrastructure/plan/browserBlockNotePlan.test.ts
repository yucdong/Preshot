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
});
