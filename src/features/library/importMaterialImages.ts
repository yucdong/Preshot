import { selectMaterialImages } from "../../domain/library/materialInsertion";
import type { MaterialEditImage, MaterialImageSelection, MaterialSummary, PortableImage } from "../../domain/library/models";
import type { MaterialContentEditorRepository, MaterialLibraryRepository } from "../../domain/library/ports";

export async function importMaterialImages(input: {
  library: MaterialLibraryRepository; editor: MaterialContentEditorRepository; sessionId: string;
  material: MaterialSummary; selection?: MaterialImageSelection; remaining: number; isCurrent(): boolean;
}): Promise<{ images: MaterialEditImage[]; visuals: PortableImage[] }> {
  const requireCurrent = () => { if (!input.isCurrent()) throw new Error("目标素材已变化或编辑已结束，请重新选择。"); };
  requireCurrent();
  const importer = input.editor.importEditImageData;
  if (!importer) throw new Error("当前环境不支持从素材库导入图片。");
  const material = await input.library.get(input.material.id);
  requireCurrent();
  if (material.revision !== input.material.revision || material.deletedAt !== null) throw new Error("素材已变化，请重新选择。");
  const payload = selectMaterialImages(material.payload, input.selection);
  const component = payload.component;
  if ((component.kind !== "image" && component.kind !== "imageGroup") || !component.images.length || component.images.length > input.remaining) {
    throw new Error("请选择图片素材，且插入后图片总数不能超过 128 张。");
  }
  const originals = component.images.map((visual) => {
    const original = material.images.find((image) => image.localImageId === visual.localImageId);
    if (!original) throw new Error("所选原图已不存在，请重新选择。");
    return original;
  });
  if (originals.reduce((bytes, image) => bytes + image.byteLength, 0) > 64 * 1024 * 1024) throw new Error("所选图片超过 64 MiB，请分批插入。");
  const images: MaterialEditImage[] = [];
  for (const original of originals) {
    requireCurrent();
    const url = await input.library.loadImage(material.id, material.revision, original.localImageId);
    requireCurrent();
    if (url.length > 24 * 1024 * 1024) throw new Error("素材图片过大，请重新选择。");
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match || match[1] !== original.mimeType) throw new Error("素材图片格式无效。");
    const bytes = atob(match[2]);
    if (bytes.length !== original.byteLength || bytes.length > 16 * 1024 * 1024) throw new Error("素材图片数据与清单不一致。");
    const copied = await importer(input.sessionId, { name: `素材图片.${original.mimeType === "image/png" ? "png" : "jpg"}`,
      mimeType: original.mimeType, bytes: Array.from(bytes, (char) => char.charCodeAt(0)) });
    requireCurrent();
    images.push(copied);
  }
  return { images, visuals: component.images };
}
