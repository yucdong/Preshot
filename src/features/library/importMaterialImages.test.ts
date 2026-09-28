import { describe, expect, it, vi } from "vitest";
import type { MaterialDetail } from "../../domain/library/models";
import { unavailableMaterialLibrary } from "../../infrastructure/library/unavailableMaterialLibrary";
import { importMaterialImages } from "./importMaterialImages";

function fixture() {
  const material: MaterialDetail = { id: "material", kind: "imageGroup", name: "组", description: "", tags: [], favorite: false,
    revision: 2, metadataVersion: 1, createdAt: 1, updatedAt: 2, deletedAt: null, previewState: "pending", imageCount: 3, byteLength: 3,
    payload: { format: "preshot-material", version: 1, kind: "imageGroup", component: { kind: "imageGroup", name: "组", description: "",
      images: ["a", "b", "c"].map((localImageId) => ({ localImageId, aspectRatio: 1, frameWidth: 100, frameHeight: 100, caption: localImageId })) } },
    images: ["a", "b", "c"].map((localImageId) => ({ localImageId, mimeType: "image/png", width: 1, height: 1, byteLength: 1, blobId: "a".repeat(64) })),
  };
  const library = { ...unavailableMaterialLibrary, get: vi.fn(async () => structuredClone(material)), loadImage: vi.fn(async () => "data:image/png;base64,AA==") };
  const importer = vi.fn(async () => ({ localImageId: `copy-${crypto.randomUUID()}`, mimeType: "image/png" as const, width: 1, height: 1, byteLength: 1, dataUrl: "data:image/png;base64,AA==" }));
  const editor = { beginCreate: vi.fn(), beginEdit: vi.fn(), loadEditImage: vi.fn(), importEditImages: vi.fn(),
    importEditImageData: importer, captureEditImage: vi.fn(), cropEditImage: vi.fn(), commitEdit: vi.fn(), discardEdit: vi.fn() };
  return { library, editor, material, importer, sessionId: "draft", remaining: 126, isCurrent: () => true };
}

describe("library images into an isolated material draft", () => {
  it("copies only selected originals in source order with fresh staging identities", async () => {
    const context = fixture();
    const result = await importMaterialImages({ ...context, selection: { mode: "imageGroup", imageIds: ["c", "a"] } });
    expect(context.library.loadImage.mock.calls).toEqual([["material", 2, "a"], ["material", 2, "c"]]);
    expect(result.visuals.map((image) => image.caption)).toEqual(["a", "c"]);
    expect(new Set(result.images.map((image) => image.localImageId)).size).toBe(2);
    expect(context.importer).toHaveBeenCalledWith("draft", { name: "素材图片.png", mimeType: "image/png", bytes: [0] });
    expect(context.editor.commitEdit).not.toHaveBeenCalled();
  });
  it("stops before staging when the source changed or the target has no capacity", async () => {
    const context = fixture();
    await expect(importMaterialImages({ ...context, remaining: 1 })).rejects.toThrow("128");
    context.library.get.mockResolvedValueOnce({ ...context.material, revision: 3 });
    await expect(importMaterialImages(context)).rejects.toThrow("素材已变化");
    expect(context.importer).not.toHaveBeenCalled();
  });
  it("does not stage late image reads after the editor retires", async () => {
    const context = fixture();
    let current = true;
    context.library.loadImage.mockImplementationOnce(async () => { current = false; return "data:image/png;base64,AA=="; });
    await expect(importMaterialImages({ ...context, isCurrent: () => current })).rejects.toThrow("编辑已结束");
    expect(context.importer).not.toHaveBeenCalled();
  });
});
