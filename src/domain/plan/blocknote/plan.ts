import type {
  ArtifactRecord,
  ImageCollection,
  ProjectPlanV14,
} from "../canvas/blockDocument";
import {
  DEFAULT_IMAGE_HEIGHT,
  LEGACY_DEFAULT_IMAGE_HEIGHT,
  MIN_COMPONENT_HEIGHT,
  type ReferenceImage,
} from "../canvas/models";
import { layoutDocumentImageGroupForWidth } from "../canvas/documentImageGroupLayout";

const FRAME_EPSILON = 0.05;

export interface LegacyDefaultImageFrameMigration {
  plan: ProjectPlanV14;
  migratedImageCount: number;
  affectedGroupCount: number;
}

export interface ImageFrameNormalization {
  plan: ProjectPlanV14;
  normalizedImageCount: number;
  affectedGroupCount: number;
}

function positiveRatio(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sourceRatio(image: ReferenceImage): number | null {
  if (
    typeof image.sourceWidth === "number" &&
    typeof image.sourceHeight === "number"
  ) {
    return positiveRatio(image.sourceWidth / image.sourceHeight);
  }
  return null;
}

function normalizedCropRatio(image: ReferenceImage): number | null {
  const crop = image.crop;
  if (
    !crop ||
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1 ||
    crop.y + crop.height > 1
  ) {
    return null;
  }
  return crop.width / crop.height;
}

function cropAdjustedRatio(
  image: ReferenceImage,
  ratio: number | null,
): number | null {
  const cropRatio = normalizedCropRatio(image);
  return ratio && cropRatio ? ratio * cropRatio : null;
}

function approximately(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= Math.max(
    FRAME_EPSILON,
    Math.abs(expected) * 0.0001,
  );
}

function effectiveFrameRatio(image: ReferenceImage): {
  ratio: number | null;
  hasUsableSourceOrCrop: boolean;
} {
  const measuredRatio = sourceRatio(image);
  const cropRatio = normalizedCropRatio(image);
  const baseRatio = measuredRatio ?? positiveRatio(image.aspectRatio);
  return {
    ratio: baseRatio && cropRatio ? baseRatio * cropRatio : baseRatio,
    hasUsableSourceOrCrop: measuredRatio !== null || cropRatio !== null,
  };
}

function defaultFrameRatioAtHeight(
  image: ReferenceImage,
  height: number,
): number | null {
  if (!approximately(image.frameHeight, height)) return null;

  const effective = effectiveFrameRatio(image);
  if (
    effective.ratio !== null &&
    approximately(image.frameWidth, height * effective.ratio)
  ) {
    return effective.ratio;
  }
  if (
    !effective.hasUsableSourceOrCrop &&
    approximately(image.frameWidth, height)
  ) {
    return 1;
  }
  return null;
}

function legacyDefaultFrameRatio(image: ReferenceImage): number | null {
  return defaultFrameRatioAtHeight(image, LEGACY_DEFAULT_IMAGE_HEIGHT);
}

function displayedRatio(
  image: ReferenceImage,
  measuredSourceRatio: number,
): number {
  return cropAdjustedRatio(image, measuredSourceRatio) ??
    measuredSourceRatio;
}

function currentDisplayedRatio(image: ReferenceImage): number {
  const measuredRatio = sourceRatio(image);
  return cropAdjustedRatio(image, measuredRatio) ??
    cropAdjustedRatio(image, positiveRatio(image.aspectRatio)) ??
    measuredRatio ??
    positiveRatio(image.frameWidth / image.frameHeight) ??
    positiveRatio(image.aspectRatio) ??
    1;
}

function isDefaultFrameAtHeight(
  image: ReferenceImage,
  height: number,
): boolean {
  return defaultFrameRatioAtHeight(image, height) !== null;
}

function hasHydratableDefaultFrame(image: ReferenceImage): boolean {
  return isDefaultFrameAtHeight(image, DEFAULT_IMAGE_HEIGHT) ||
    isDefaultFrameAtHeight(image, LEGACY_DEFAULT_IMAGE_HEIGHT);
}

export function migrateLegacyDefaultImageFrames(
  plan: ProjectPlanV14,
): LegacyDefaultImageFrameMigration {
  let migratedImageCount = 0;
  let affectedGroupCount = 0;
  const imageGroups = plan.imageGroups.map((group) => {
    let groupChanged = false;
    const images = group.images.map((image) => {
      const ratio = legacyDefaultFrameRatio(image);
      if (ratio === null) return image;
      groupChanged = true;
      migratedImageCount += 1;
      return {
        ...image,
        frameWidth: DEFAULT_IMAGE_HEIGHT * ratio,
        frameHeight: DEFAULT_IMAGE_HEIGHT,
      };
    });
    if (!groupChanged) return group;
    affectedGroupCount += 1;
    return {
      ...group,
      images,
      height: Math.max(
        MIN_COMPONENT_HEIGHT,
        layoutDocumentImageGroupForWidth(images, group.width).height,
      ),
    };
  });

  return {
    plan: migratedImageCount > 0 ? { ...plan, imageGroups } : plan,
    migratedImageCount,
    affectedGroupCount,
  };
}

export function normalizeAllImageFramesToDefaultHeight(
  plan: ProjectPlanV14,
): ImageFrameNormalization {
  let normalizedImageCount = 0;
  let affectedGroupCount = 0;
  const imageGroups = plan.imageGroups.map((group) => {
    if (group.images.length === 0) return group;
    affectedGroupCount += 1;
    const images = group.images.map((image) => {
      normalizedImageCount += 1;
      return {
        ...image,
        frameWidth: DEFAULT_IMAGE_HEIGHT * currentDisplayedRatio(image),
        frameHeight: DEFAULT_IMAGE_HEIGHT,
      };
    });
    return {
      ...group,
      images,
      height: Math.max(
        MIN_COMPONENT_HEIGHT,
        layoutDocumentImageGroupForWidth(images, group.width).height,
      ),
    };
  });
  return {
    plan: normalizedImageCount > 0 ? { ...plan, imageGroups } : plan,
    normalizedImageCount,
    affectedGroupCount,
  };
}

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
  const hydrateImage = (image: ReferenceImage): {
    image: ReferenceImage;
    changed: boolean;
    defaultFrameHydrated: boolean;
  } => {
    if (image.file !== input.file) {
      return { image, changed: false, defaultFrameHydrated: false };
    }
    const defaultFrame = hasHydratableDefaultFrame(image);
    const frameHeight = defaultFrame
      ? DEFAULT_IMAGE_HEIGHT
      : image.frameHeight;
    const frameWidth = defaultFrame
      ? frameHeight * displayedRatio(image, aspectRatio)
      : image.frameWidth;
    const crop = image.crop ??
      (defaultFrame ? { x: 0, y: 0, width: 1, height: 1 } : undefined);
    if (
      image.aspectRatio === aspectRatio &&
      image.sourceWidth === input.sourceWidth &&
      image.sourceHeight === input.sourceHeight &&
      image.frameWidth === frameWidth &&
      image.frameHeight === frameHeight &&
      image.crop === crop
    ) {
      return { image, changed: false, defaultFrameHydrated: defaultFrame };
    }
    return {
      image: {
        ...image,
        aspectRatio,
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight,
        frameWidth,
        frameHeight,
        ...(crop ? { crop } : {}),
      },
      changed: true,
      defaultFrameHydrated: defaultFrame,
    };
  };
  const imageGroups = plan.imageGroups.map((group) => {
    let groupChanged = false;
    let defaultFrameHydrated = false;
    const images = group.images.map((image) => {
      const result = hydrateImage(image);
      groupChanged ||= result.changed;
      defaultFrameHydrated ||= result.defaultFrameHydrated;
      return result.image;
    });
    if (!groupChanged) return group;
    changed = true;
    return {
      ...group,
      images,
      height: defaultFrameHydrated
        ? Math.max(
            MIN_COMPONENT_HEIGHT,
            layoutDocumentImageGroupForWidth(images, group.width).height,
          )
        : group.height,
    };
  });
  const mapCollection = (collection: ImageCollection): ImageCollection => {
    let collectionChanged = false;
    const images = collection.images.map((image) => {
        const result = hydrateImage(image);
        collectionChanged ||= result.changed;
        return result.image;
    });
    if (!collectionChanged) return collection;
    changed = true;
    return { ...collection, images };
  };
  const artifacts = plan.artifacts.map((artifact): ArtifactRecord => {
    if (artifact.kind === "shootingLocation") {
        const gallery = mapCollection(artifact.gallery);
        return gallery === artifact.gallery
          ? artifact
          : { ...artifact, gallery };
    }
    if (artifact.kind === "modelCard") {
        const samples = mapCollection(artifact.samples);
        return samples === artifact.samples
          ? artifact
          : { ...artifact, samples };
    }
    if (artifact.kind === "clothing") {
        const mainGallery = mapCollection(artifact.mainGallery);
        const gallery = mapCollection(artifact.tryOn.gallery);
        return mainGallery === artifact.mainGallery &&
            gallery === artifact.tryOn.gallery
          ? artifact
          : {
              ...artifact,
              mainGallery,
              tryOn: { ...artifact.tryOn, gallery },
            };
    }
    const gallery = mapCollection(artifact.gallery);
    return gallery === artifact.gallery
        ? artifact
        : { ...artifact, gallery };
  });
  return changed ? { ...plan, imageGroups, artifacts } : plan;
}
