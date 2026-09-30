import { nativeImagePresentation } from "../plan/canvas/nativeImagePresentation";
import { artifactCollectionsInPlan, type ProjectPlanV15, type PreshotBlock } from "../plan/canvas/blockDocument";
import type { ReferenceImage } from "../plan/canvas/models";
import type { MaterialSnapshot } from "./models";
import { validateLibraryPlan, validateMaterialPayload } from "./validation";

export function findImageMaterialBlock(plan: ProjectPlanV15, blockId: string): PreshotBlock | undefined {
  const find = (blocks: PreshotBlock[]): PreshotBlock | undefined => {
    for (const block of blocks) {
      if (block.id === blockId) return block;
      const nested = find(block.children);
      if (nested) return nested;
    }
  };
  return find(plan.document.blocks);
}

export function createImageMaterialSnapshot(
  input: ProjectPlanV15,
  blockId: string,
  imageId?: string,
  dimensions?: { sourceWidth: number; sourceHeight: number },
): MaterialSnapshot {
  const plan = validateLibraryPlan(input);
  const block = findImageMaterialBlock(plan, blockId);
  if (!block) throw new Error("图片所在组件已变化，请重新选择。");
  let image: ReferenceImage | undefined;
  let name = "图片";
  if (block.type === "image") {
    const file = block.props.url;
    if (imageId || typeof file !== "string" || !/^media\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g)$/i.test(file) || !dimensions) {
      throw new Error("请先将 JPG 或 PNG 图片上传到项目，再保存到素材库。");
    }
    const { sourceWidth, sourceHeight } = dimensions;
    if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error("无法读取图片尺寸，请重新加载图片。");
    }
    image = { ...nativeImagePresentation(block.props, sourceWidth, sourceHeight), id: blockId, file,
      caption: typeof block.props.caption === "string" ? block.props.caption : "" };
    name = typeof block.props.name === "string" && block.props.name ? block.props.name : "图片";
  } else {
    const entries = block.type === "imageGroup"
      ? plan.imageGroups.find(({ id }) => id === block.props.groupId)?.images
      : artifactCollectionsInPlan({ ...plan, artifacts: plan.artifacts.filter(({ id }) => id === block.props.artifactId) })
        .flatMap(({ images }) => images);
    image = entries?.find(({ id }) => id === imageId);
    if (!image) throw new Error("图片已不属于当前组件，请重新选择。");
    name = image.caption?.trim() || "图片";
  }
  const { id, file, ...visual } = image;
  void id;
  const localImageId = "material-image-1";
  return {
    sourceBlockId: blockId,
    payload: validateMaterialPayload({ format: "preshot-material", version: 2, kind: "image",
      component: { kind: "image", name, description: "", images: [{ ...visual, localImageId }] } }),
    sources: [{ localImageId, file }], omittedLegacyImages: 0,
  };
}
