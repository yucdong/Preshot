import { artifactCollectionsInPlan, mediaFilesInBlockDocument, validateProjectPlanV15,
  type PreshotBlock, type ProjectPlanV15 } from "../plan/canvas/blockDocument";
import { instantiateMaterial } from "./material";
import type { MaterialPayload, PreparedMaterialInsert } from "./models";

export function insertMaterialIntoGallery(plan: ProjectPlanV15, prepared: PreparedMaterialInsert,
  payload: MaterialPayload, makeId: () => string): { plan: ProjectPlanV15; lastBlockId: string } {
  const group = plan.imageGroups.find((item) => item.id === prepared.targetGroupId);
  const component = payload.component;
  if (!group || (component.kind !== "image" && component.kind !== "imageGroup") ||
      prepared.selection?.mode === "images" || component.images.length === 0 ||
      group.images.length + component.images.length > 128) {
    throw new Error("请选择图片或图片组素材；目标图片组须存在且总图片数不超过 128 张。");
  }
  const files = new Set([...plan.imageGroups, ...artifactCollectionsInPlan(plan)]
    .flatMap((entry) => entry.images.map((image) => image.file)));
  mediaFilesInBlockDocument(plan.document).forEach((file) => files.add(file));
  for (const source of prepared.images) {
    if (files.has(source.file)) throw new Error("素材插入必须使用独立的新图片文件。");
    files.add(source.file);
  }
  const instance = instantiateMaterial({ ...payload, kind: "imageGroup", component: { ...component, kind: "imageGroup" } }, prepared.images, makeId);
  const findOwner = (blocks: PreshotBlock[]): PreshotBlock | undefined => {
    for (const block of blocks) {
      if (block.type === "imageGroup" && block.props.groupId === group.id) return block;
      const child = findOwner(block.children);
      if (child) return child;
    }
  };
  const owner = findOwner(plan.document.blocks);
  if (!owner) throw new Error("目标图片组已不在文档中，请重新选择。");
  const next = validateProjectPlanV15({ ...plan, imageGroups: plan.imageGroups.map((item) => item.id === group.id
    ? { ...item, images: [...item.images, ...instance.imageGroup!.images] } : item) });
  return { plan: next, lastBlockId: owner.id };
}
