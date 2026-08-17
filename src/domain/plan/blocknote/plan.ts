import type { ProjectPlanV14 } from "../canvas/blockDocument";

export function setBlockNoteImageNaturalDimensions(
  plan: ProjectPlanV14,
  input: {
    file: string;
    sourceWidth: number;
    sourceHeight: number;
  },
): ProjectPlanV14 {
  if (
    !Number.isFinite(input.sourceWidth) ||
    input.sourceWidth <= 0 ||
    !Number.isFinite(input.sourceHeight) ||
    input.sourceHeight <= 0
  ) {
    return plan;
  }
  const aspectRatio = input.sourceWidth / input.sourceHeight;
  let changed = false;
  const imageGroups = plan.imageGroups.map((group) => {
    let groupChanged = false;
    const images = group.images.map((image) => {
      if (image.file !== input.file) return image;
      const frameWidth = image.frameHeight * aspectRatio;
      if (
        image.aspectRatio === aspectRatio &&
        image.sourceWidth === input.sourceWidth &&
        image.sourceHeight === input.sourceHeight &&
        image.frameWidth === frameWidth
      ) {
        return image;
      }
      groupChanged = true;
      return {
        ...image,
        aspectRatio,
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight,
        frameWidth,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      };
    });
    if (!groupChanged) return group;
    changed = true;
    return { ...group, images };
  });
  return changed ? { ...plan, imageGroups } : plan;
}
