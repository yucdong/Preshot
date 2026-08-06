import type { CropRect, ProjectPlan, ReferenceImage } from "./models";

export function normalizeCrop(crop: CropRect): CropRect | undefined {
  if (
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
    return undefined;
  }
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1 ? undefined : crop;
}

export function effectiveImageAspectRatio(image: ReferenceImage): number {
  const crop = image.crop && normalizeCrop(image.crop);
  return crop ? image.aspectRatio * (crop.width / crop.height) : image.aspectRatio;
}

function updateImage(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string },
  transform: (image: ReferenceImage) => ReferenceImage,
): ProjectPlan {
  let changed = false;
  const components = plan.components.map((component) => {
    if (component.type !== "reference" || component.id !== params.componentId) {
      return component;
    }
    const images = component.images.map((image) => {
      if (image.id !== params.imageId) {
        return image;
      }
      const next = transform(image);
      changed ||= next !== image;
      return next;
    });
    return changed ? { ...component, images } : component;
  });
  return changed ? { ...plan, components } : plan;
}

export function setImageCrop(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string; crop: CropRect },
): ProjectPlan {
  const crop = normalizeCrop(params.crop);
  if (!crop) {
    return params.crop.x === 0 &&
      params.crop.y === 0 &&
      params.crop.width === 1 &&
      params.crop.height === 1
      ? resetImageCrop(plan, params)
      : plan;
  }
  return updateImage(plan, params, (image) =>
    image.crop?.x === crop.x &&
    image.crop.y === crop.y &&
    image.crop.width === crop.width &&
    image.crop.height === crop.height
      ? image
      : { ...image, crop },
  );
}

export function resetImageCrop(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string },
): ProjectPlan {
  return updateImage(plan, params, (image) => {
    if (!image.crop) {
      return image;
    }
    const { crop: _crop, ...withoutCrop } = image;
    return withoutCrop;
  });
}
