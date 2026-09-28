// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageClipboardContents } from "../../../domain/clipboard/imageClipboard";
import { clipboardPasteAsset } from "./imagePasteAssets";

const png = "data:image/png;base64,AQID";
const decode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
beforeEach(() => {
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: async () => undefined });
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(3);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(2);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (decode) Object.defineProperty(HTMLImageElement.prototype, "decode", decode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
});
const contents: ImageClipboardContents = {
  original: { dataUrl: "data:image/jpeg;base64,BAUG", name: "参考.jpg",
    presentation: { aspectRatio: 1.5, frameWidth: 300, frameHeight: 200, fitMode: "stretch" } },
  renderedDataUrl: png, external: false, animated: false,
};
describe("clipboard paste asset conversion", () => {
  it("preserves original JPEG bytes within galleries and uses composed pixels for native blocks", async () => {
    const gallery = await clipboardPasteAsset(contents, { kind: "gallery", groupId: "g", afterImageId: null });
    expect(gallery.image).toEqual({ name: "参考.jpg", mimeType: "image/jpeg", bytes: [4, 5, 6] });
    const native = await clipboardPasteAsset(contents, { kind: "document", afterBlockId: null });
    expect(native.image).toEqual({ name: "参考.png", mimeType: "image/png", bytes: [1, 2, 3] });
    expect(native.dimensions).toEqual({ width: 3, height: 2 });
  });
  it("preserves animated native bytes only in native blocks and converts static-only galleries", async () => {
    const animated = { ...contents, animated: true,
      original: { dataUrl: "data:image/gif;base64,BAUG", name: "动图.gif" } };
    expect((await clipboardPasteAsset(animated, { kind: "document", afterBlockId: null })).image.mimeType).toBe("image/gif");
    expect((await clipboardPasteAsset(animated, { kind: "gallery", groupId: "g", afterImageId: null })).image.mimeType).toBe("image/png");
  });
  it("flattens animated PNG for galleries without applying an already-rendered crop twice", async () => {
    const animated: ImageClipboardContents = {
      ...contents, animated: true,
      original: { ...contents.original, dataUrl: "data:image/png;base64,BAUG", name: "animated.png",
        presentation: { aspectRatio: 2, frameWidth: 300, frameHeight: 200, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } } },
    };
    const gallery = await clipboardPasteAsset(animated, { kind: "gallery", groupId: "g", afterImageId: null });
    expect(gallery.image.bytes).toEqual([1, 2, 3]);
    expect(gallery.presentation?.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(gallery.presentation?.frameWidth).toBe(300);
    expect((await clipboardPasteAsset({ ...animated, original: { ...animated.original, presentation: undefined } },
      { kind: "document", afterBlockId: null })).image.bytes).toEqual([4, 5, 6]);
  });
  it("rejects URLs and invalid encoded data before trying to load an image", async () => {
    await expect(clipboardPasteAsset({ ...contents, original: { name: "remote", dataUrl: "https://invalid/image.png" }, renderedDataUrl: "bad" },
      { kind: "document", afterBlockId: null })).rejects.toThrow();
  });
  it("uses portable names for material titles and native rename labels", async () => {
    const pasted = await clipboardPasteAsset({ ...contents,
      original: { name: "CON:100%?.png", dataUrl: png } }, { kind: "document", afterBlockId: null });
    expect(pasted.image.name).toBe("CON-100--.png");
    const reserved = await clipboardPasteAsset({ ...contents,
      original: { name: "CON.png", dataUrl: png } }, { kind: "document", afterBlockId: null });
    expect(reserved.image.name).toBe("image-CON.png");
  });
});
