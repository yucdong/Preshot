import type { MaterialDetail, MaterialPreviewInput } from "../../src/domain/library/models";
import { createMaterialPreview } from "../../src/infrastructure/library/materialPreview";
import { unavailableMaterialLibrary } from "../../src/infrastructure/library/unavailableMaterialLibrary";

export async function captureColoredMaterial(): Promise<number> {
  if (import.meta.env.MODE !== "e2e") throw new Error("E2E fixture only");
  const source = document.createElement("canvas");
  source.width = source.height = 8;
  const context = source.getContext("2d")!;
  context.fillStyle = "#ff00ff";
  context.fillRect(0, 0, 8, 8);
  const dataUrl = source.toDataURL("image/png");
  const byteLength = atob(dataUrl.split(",")[1]).length;
  const material: MaterialDetail = {
    id: "policy-test", kind: "image", name: "Policy image", description: "", tags: [],
    favorite: false, revision: 1, metadataVersion: 1, createdAt: 1, updatedAt: 1,
    deletedAt: null, imageCount: 1, byteLength, previewState: "pending",
    payload: { format: "preshot-material", version: 1, kind: "image",
      component: { kind: "image", name: "Policy image", description: "", images: [{
        localImageId: "image-1", aspectRatio: 1, frameWidth: 240, frameHeight: 240,
        sourceWidth: 8, sourceHeight: 8,
      }] } },
    images: [{ localImageId: "image-1", blobId: "a".repeat(64), mimeType: "image/png",
      byteLength, width: 8, height: 8 }],
  };
  let saved: MaterialPreviewInput | undefined;
  await createMaterialPreview({ ...unavailableMaterialLibrary, availability: "test",
    loadImage: async () => dataUrl,
    savePreview: async (_id, _revision, preview) => { saved = preview; },
    markPreviewFailed: async () => undefined,
  }, material);
  if (!saved) throw new Error("Thumbnail was not saved");
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(saved.bytes)], { type: "image/png" }));
  const result = document.createElement("canvas");
  result.width = bitmap.width;
  result.height = bitmap.height;
  const pixels = result.getContext("2d")!;
  pixels.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = pixels.getImageData(0, 0, result.width, result.height).data;
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) colored++;
  }
  return colored;
}
