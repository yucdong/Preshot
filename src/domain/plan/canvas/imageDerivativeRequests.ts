import { artifactCollectionsInPlan, type ProjectPlanV15, type PreshotBlock } from "./blockDocument";

/** Logical frame size and crop determine the required source resolution. This
 * bounds display/export memory independently from the original's encoded size. */
export function imageDerivativeRequests(plan: ProjectPlanV15, outputWidth: number, density = 2): Map<string, number> {
  const requests = new Map<string, number>();
  const add = (file: string, width: number, height: number, cropWidth = 1, cropHeight = 1) => {
    if (!/^(references|media)\/.+\.(png|jpe?g)$/i.test(file)) return;
    const edge = Math.min(4096, Math.max(64, Math.ceil(Math.max(width / cropWidth, height / cropHeight) * outputWidth / 1008 * density)));
    requests.set(file, Math.max(requests.get(file) ?? 0, edge));
  };
  for (const collection of [...plan.imageGroups, ...artifactCollectionsInPlan(plan)]) {
    for (const image of collection.images) add(image.file, image.frameWidth, image.frameHeight,
      image.fitMode === "stretch" ? 1 : image.crop?.width, image.fitMode === "stretch" ? 1 : image.crop?.height);
  }
  const visit = (blocks: PreshotBlock[]) => {
    for (const block of blocks) {
      if (block.type === "image") add(String(block.props.url), Number(block.props.previewWidth) || 1008,
        Number(block.props.previewHeight) || Number(block.props.previewWidth) || 1008,
        Number(block.props.cropWidth) || 1, Number(block.props.cropHeight) || 1);
      visit(block.children);
    }
  };
  visit(plan.document.blocks);
  return requests;
}
