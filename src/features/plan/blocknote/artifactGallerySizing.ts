import {
  DOCUMENT_IMAGE_GROUP_GAP,
  DOCUMENT_IMAGE_GROUP_INSET,
} from "../../../domain/plan/canvas/documentImageGroupLayout";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";

export const ARTIFACT_COMPACT_IMAGE_THRESHOLD = 4;
export const ARTIFACT_COMPACT_MIN_SCALE = 0.35;

export function compactArtifactGalleryImages(
  images: readonly ReferenceImage[],
  availableWidth: number,
  enabled: boolean,
): ReferenceImage[] {
  if (
    !enabled ||
    images.length === 0 ||
    !Number.isFinite(availableWidth) ||
    availableWidth <= DOCUMENT_IMAGE_GROUP_INSET * 2
  ) {
    return images as ReferenceImage[];
  }

  const dense = images.length > ARTIFACT_COMPACT_IMAGE_THRESHOLD;
  const columns = images.length >= 10 ? 4 : dense ? 3 : 1;
  const innerWidth = Math.max(
    1,
    availableWidth -
      DOCUMENT_IMAGE_GROUP_INSET * 2 -
      DOCUMENT_IMAGE_GROUP_GAP * Math.max(0, columns - 1),
  );
  const targetWidth = innerWidth / columns;
  const commonBaseHeight = Math.min(
    240,
    Math.max(...images.map((image) => image.frameHeight)),
  );
  const widestAspectRatio = Math.max(
    1 / 100,
    ...images.map((image) =>
      Number.isFinite(image.aspectRatio) && image.aspectRatio > 0
        ? image.aspectRatio
        : image.frameWidth / Math.max(1, image.frameHeight)
    ),
  );
  const denseHeight = targetWidth / widestAspectRatio;
  const commonHeight = Math.max(
    commonBaseHeight * ARTIFACT_COMPACT_MIN_SCALE,
    Math.min(commonBaseHeight, denseHeight),
  );

  return images.map((image) => ({
    ...image,
    frameWidth: commonHeight * (
      Number.isFinite(image.aspectRatio) && image.aspectRatio > 0
        ? image.aspectRatio
        : image.frameWidth / Math.max(1, image.frameHeight)
    ),
    frameHeight: commonHeight,
    frameOffsetX: 0,
    frameOffsetY: 0,
  }));
}
