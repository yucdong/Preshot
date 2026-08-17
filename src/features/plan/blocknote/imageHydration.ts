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
  measure: (dataUrl: string) => Promise<SourceImageDimensions> =
    measureImageDimensions,
): Promise<ProjectPlanV14> {
  let next = plan;
  for (const [file, dataUrl] of entries) {
    next = setBlockNoteImageNaturalDimensions(next, {
      file,
      ...await measure(dataUrl),
    });
  }
  return next;
}
