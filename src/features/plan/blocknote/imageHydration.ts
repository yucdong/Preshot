import { artifactCollectionsInPlan } from "../../../domain/plan/canvas/blockDocument";
import { setBlockNoteImageNaturalDimensions } from "../../../domain/plan/blocknote/plan";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";

export interface SourceImageDimensions {
  sourceWidth: number;
  sourceHeight: number;
}

export async function measureImageDimensions(
  dataUrl: string,
): Promise<SourceImageDimensions> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to measure imported image"));
  });
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    await loaded;
  }
  return {
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
  };
}

export async function applyMeasuredImages(
  plan: ProjectPlanV14,
  entries: ReadonlyArray<readonly [string, string]>,
  measure: (dataUrl: string, file: string) => Promise<SourceImageDimensions> =
    measureImageDimensions,
): Promise<ProjectPlanV14> {
  // Keep full-resolution decodes concurrent without starting every image at once.
  const dimensions = new Array<SourceImageDimensions>(entries.length);
  let cursor = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (!failed && cursor < entries.length) {
      const index = cursor++;
      try {
        const existing = [...plan.imageGroups, ...artifactCollectionsInPlan(plan)].flatMap(group => group.images).find(image => image.file === entries[index][0]);
        dimensions[index] = measure === measureImageDimensions && existing?.sourceWidth && existing.sourceHeight
          ? { sourceWidth: existing.sourceWidth, sourceHeight: existing.sourceHeight }
          : await measure(entries[index][1], entries[index][0]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }));
  let next = plan;
  for (const [index, [file]] of entries.entries()) {
    next = setBlockNoteImageNaturalDimensions(next, {
      file,
      ...dimensions[index],
    });
  }
  return next;
}
