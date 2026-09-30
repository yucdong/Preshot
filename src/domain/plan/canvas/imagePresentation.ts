import { artifactCollectionsInPlan, type PreshotBlockDocument, type ProjectPlanV15 } from "./blockDocument";
import type { ImagePresentationAxes } from "./models";

const EXIF_ASSET_SUFFIX = "#preshot-exif";

/** Render-only identity. The suffix must never be written as a project path. */
export function imageAssetKey(file: string, axes?: ImagePresentationAxes): string {
  return axes === "exif" && /^(references|media)\//i.test(file) ? `${file}${EXIF_ASSET_SUFFIX}` : file;
}

export function imageAssetSource(key: string): { file: string; presentationAxes: ImagePresentationAxes } {
  return key.endsWith(EXIF_ASSET_SUFFIX)
    ? { file: key.slice(0, -EXIF_ASSET_SUFFIX.length), presentationAxes: "exif" }
    : { file: key, presentationAxes: "raw" };
}

export function referenceImageAssets(plan: ProjectPlanV15) {
  return new Map([...plan.imageGroups, ...artifactCollectionsInPlan(plan)].flatMap(group =>
    group.images.map(image => [imageAssetKey(image.file, image.presentationAxes),
      { file: image.file, presentationAxes: image.presentationAxes }] as const)));
}

export function nativeMediaAssets(document: PreshotBlockDocument) {
  const assets = new Map<string, { file: string; presentationAxes?: ImagePresentationAxes }>();
  const visit = (blocks: typeof document.blocks) => {
    for (const block of blocks) {
      const file = block.props.url;
      if (["image", "video", "audio", "file"].includes(block.type) && typeof file === "string" && /^media\//i.test(file)) {
        const presentationAxes = block.type === "image" && block.props.presentationAxes === "exif" ? "exif" : undefined;
        assets.set(imageAssetKey(file, presentationAxes), { file, presentationAxes });
      }
      visit(block.children);
    }
  };
  visit(document.blocks);
  return assets;
}
