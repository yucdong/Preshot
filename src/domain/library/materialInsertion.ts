import type { ProjectPlanV15 } from "../plan/canvas/blockDocument";
import { instantiateMaterial, insertMaterialIntoPlan } from "./material";
import type { MaterialImageSelection, MaterialPayload, PreparedMaterialInsert } from "./models";
import { exactRecord, validateMaterialPayload } from "./validation";
import { insertMaterialIntoGallery } from "./materialGalleryInsertion";

/** Keep the material's image order, regardless of checkbox click order. */
export function selectMaterialImages(payload: MaterialPayload, selection?: MaterialImageSelection): MaterialPayload {
  const validated = validateMaterialPayload(payload);
  if (!selection) return validated;
  exactRecord(selection, ["imageIds", "mode"], "Material image selection");
  const component = validated.component;
  if (component.kind !== "imageGroup" || !["imageGroup", "images"].includes(selection.mode) ||
      !Array.isArray(selection.imageIds) || selection.imageIds.length === 0 || selection.imageIds.length > 128) {
    throw new Error("请选择图片组中的一张或多张图片及插入形式。");
  }
  const ids = new Set(selection.imageIds);
  if (ids.size !== selection.imageIds.length || selection.imageIds.some((id) =>
    typeof id !== "string" || !component.images.some((image) => image.localImageId === id))) {
    throw new Error("所选图片已变化，请重新选择。");
  }
  return { ...validated, component: { ...component, images: component.images.filter((image) => ids.has(image.localImageId)) } };
}

export function insertPreparedMaterial(
  plan: ProjectPlanV15, prepared: PreparedMaterialInsert, anchor: string | null, makeId: () => string,
): { plan: ProjectPlanV15; lastBlockId: string } {
  const payload = selectMaterialImages(prepared.payload, prepared.selection);
  // Prepared replies must contain only the selected images and their copied files.
  if (JSON.stringify(payload) !== JSON.stringify(validateMaterialPayload(prepared.payload))) {
    throw new Error("素材插入回执包含未选择的图片。");
  }
  if (prepared.targetGroupId !== undefined) return insertMaterialIntoGallery(plan, prepared, payload, makeId);
  if (prepared.selection?.mode !== "images") {
    const instance = instantiateMaterial(payload, prepared.images, makeId);
    return { plan: insertMaterialIntoPlan(plan, instance, anchor), lastBlockId: instance.block.id };
  }
  if (payload.component.kind !== "imageGroup") throw new Error("只能拆分图片组素材。");
  const component = payload.component;
  if (prepared.images.length !== component.images.length ||
      new Set(prepared.images.map((image) => image.localImageId)).size !== component.images.length) {
    throw new Error("插入图片文件与所选图片不一致。");
  }
  let next = plan;
  let lastBlockId = anchor;
  for (const image of component.images) {
    const source = prepared.images.find((file) => file.localImageId === image.localImageId);
    if (!source) throw new Error("缺少所选图片的项目副本。");
    const instance = instantiateMaterial({ format: "preshot-material", version: 1, kind: "image",
      component: { kind: "image", name: component.name, description: "", images: [image] },
    }, [source], makeId);
    next = insertMaterialIntoPlan(next, instance, lastBlockId);
    lastBlockId = instance.block.id;
  }
  return { plan: next, lastBlockId: lastBlockId! };
}
