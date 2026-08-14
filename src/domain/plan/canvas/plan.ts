import {
  DEFAULT_IMAGE_HEIGHT,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
  type ReferenceImage,
} from "./models";
import {
  clampCardRect,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  moveCard,
  resizeCard,
} from "./geometry";
import { firstTextLeaf, updateTextLeafHtml } from "./textTree";
import {
  centeredCoverCrop,
  cropForResizedFrame,
  normalizeImageCrop,
  type NormalizedImageCrop,
} from "./imageView";
import { removeImageGroupMarker } from "./document";

export interface MoveImageParams {
  fromComponentId: string;
  imageId: string;
  toComponentId: string;
  toIndex: number;
}

export interface ComponentMoveTarget {
  x: number;
  y: number;
}

export interface MoveImagesParams {
  imageIds: string[];
  toComponentId: string;
  toIndex: number;
}

export function defaultImageFrame(aspectRatio: number): {
  frameWidth: number;
  frameHeight: number;
} {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  return {
    frameWidth: DEFAULT_IMAGE_HEIGHT * ratio,
    frameHeight: DEFAULT_IMAGE_HEIGHT,
  };
}

function hasDefaultImageFrame(image: ReferenceImage): boolean {
  const expected = defaultImageFrame(image.aspectRatio);
  return (
    Math.abs(image.frameWidth - expected.frameWidth) < 0.001 &&
    Math.abs(image.frameHeight - expected.frameHeight) < 0.001
  );
}

function replace(plan: ProjectPlan, components: PlanComponent[]): ProjectPlan {
  return { ...plan, components };
}

function mapComponent(
  plan: ProjectPlan,
  id: string,
  transform: (component: PlanComponent) => PlanComponent,
): ProjectPlan {
  let changed = false;
  const components = plan.components.map((component) => {
    if (component.id !== id) {
      return component;
    }
    const next = transform(component);
    if (next !== component) {
      changed = true;
    }
    return next;
  });
  return changed ? replace(plan, components) : plan;
}

function mapReference(
  plan: ProjectPlan,
  id: string,
  transform: (component: ReferenceComponent) => ReferenceComponent,
): ProjectPlan {
  return mapComponent(plan, id, (component) =>
    component.type === "reference" ? transform(component) : component,
  );
}

export function addComponent(plan: ProjectPlan, component: PlanComponent): ProjectPlan {
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  const rect = clampCardRect(
    {
      x: component.x,
      y: 0,
      width: component.width,
      height: component.height,
    },
    canvasWidth,
  );
  const storedComponent: PlanComponent = component.type === "plan"
    ? {
        id: component.id,
        name: component.name,
        type: "plan",
        x: rect.x,
        width: rect.width,
        height: rect.height,
        ...(component.contentScale === undefined ? {} : { contentScale: component.contentScale }),
        textRoot: component.textRoot,
      }
    : {
        id: component.id,
        name: component.name,
        type: "reference",
        x: rect.x,
        width: rect.width,
        height: rect.height,
        description: component.description,
        images: component.images,
      };
  return replace(plan, [storedComponent, ...plan.components]);
}

export function removeComponent(plan: ProjectPlan, id: string): ProjectPlan {
  const components = plan.components.filter((component) => component.id !== id);
  if (components.length === plan.components.length) return plan;
  return {
    ...replace(plan, components),
    ...(plan.documentHtml === undefined
      ? {}
      : { documentHtml: removeImageGroupMarker(plan.documentHtml, id) }),
  };
}

export function moveComponent(
  plan: ProjectPlan,
  params: { id: string } & ComponentMoveTarget,
): ProjectPlan {
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  return mapComponent(plan, params.id, (component) => {
    const next = moveCard({ ...component, y: 0 }, { x: params.x, y: 0 }, canvasWidth);
    return next.x === component.x
      ? component
      : { ...component, x: next.x };
  });
}

export function reorderComponent(
  plan: ProjectPlan,
  params: { id: string; toIndex: number },
): ProjectPlan {
  const activeIndex = plan.components.findIndex((component) => component.id === params.id);
  if (activeIndex < 0) {
    return plan;
  }

  const active = plan.components[activeIndex];
  const remaining = plan.components.filter((component) => component.id !== params.id);
  const toIndex = Math.max(0, Math.min(remaining.length, Math.trunc(params.toIndex)));
  const components = [...remaining.slice(0, toIndex), active, ...remaining.slice(toIndex)];

  return components.every((component, index) => component === plan.components[index])
    ? plan
    : replace(plan, components);
}

export function resizeComponent(
  plan: ProjectPlan,
  params: {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    frameOffsetY?: number;
  },
): ProjectPlan {
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  return mapComponent(plan, params.id, (component) => {
    const resized = resizeCard(
      {
        ...component,
        x: params.x ?? component.x,
        y: 0,
        width: params.width ?? component.width,
        height: params.height ?? component.height,
      },
      {
        width: params.width ?? component.width,
        height: params.height ?? component.height,
      },
      canvasWidth,
    );
    if (
      resized.x === component.x &&
      resized.width === component.width &&
      resized.height === component.height &&
      (
        component.type !== "reference" ||
        (component.frameOffsetY ?? 0) ===
          (params.frameOffsetY ?? component.frameOffsetY ?? 0)
      )
    ) {
      return component;
    }
    return {
      ...component,
      x: resized.x,
      width: resized.width,
      height: resized.height,
      ...(component.type === "reference"
        ? { frameOffsetY: params.frameOffsetY ?? component.frameOffsetY ?? 0 }
        : {}),
    };
  });
}

export function updatePlanHtml(plan: ProjectPlan, params: { id: string; html: string }): ProjectPlan {
  const component = plan.components.find(
    (entry): entry is Extract<PlanComponent, { type: "plan" }> =>
      entry.id === params.id && entry.type === "plan",
  );
  return component
    ? updateTextLeafHtml(plan, {
        componentId: component.id,
        leafId: firstTextLeaf(component.textRoot).id,
        html: params.html,
      })
    : plan;
}

export function setReferenceTitle(plan: ProjectPlan, id: string, title: string): ProjectPlan {
  return mapReference(plan, id, (component) =>
    component.name === title ? component : { ...component, name: title },
  );
}

export function setReferenceDescription(plan: ProjectPlan, id: string, description: string): ProjectPlan {
  return mapReference(plan, id, (component) =>
    component.description === description ? component : { ...component, description },
  );
}

export function addReferenceImage(
  plan: ProjectPlan,
  params: { componentId: string; image: ReferenceImage },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => ({
    ...component,
    images: [...component.images, params.image],
  }));
}

export function addReferenceImages(
  plan: ProjectPlan,
  params: { componentId: string; images: ReferenceImage[] },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => ({
    ...component,
    images: [...component.images, ...params.images],
  }));
}

export function removeReferenceImage(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => {
    const images = component.images.filter((image) => image.id !== params.imageId);
    return images.length === component.images.length ? component : { ...component, images };
  });
}

export function setImageCaption(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string; caption: string },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => {
    const target = component.images.find((image) => image.id === params.imageId);
    if (!target || target.caption === params.caption) {
      return component;
    }
    return {
      ...component,
      images: component.images.map((image) =>
        image.id === params.imageId ? { ...image, caption: params.caption } : image,
      ),
    };
  });
}

export function setImageAspectRatio(
  plan: ProjectPlan,
  params: { componentId: string; imageId: string; aspectRatio: number },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => {
    const target = component.images.find((image) => image.id === params.imageId);
    if (!target || target.aspectRatio === params.aspectRatio) {
      return component;
    }
    return {
      ...component,
      images: component.images.map((image) =>
        image.id === params.imageId ? { ...image, aspectRatio: params.aspectRatio } : image,
      ),
    };
  });
}

export function setImageAspectRatioForFile(
  plan: ProjectPlan,
  params: { file: string; aspectRatio: number; sourceWidth?: number; sourceHeight?: number },
): ProjectPlan {
  if (!Number.isFinite(params.aspectRatio) || params.aspectRatio <= 0) {
    return plan;
  }
  let changed = false;
  const components = plan.components.map((component) => {
    if (component.type !== "reference") {
      return component;
    }

    let imagesChanged = false;
    const images = component.images.map((image) => {
      if (image.file !== params.file) {
        return image;
      }
      const measuredSource =
        typeof params.sourceWidth === "number" && params.sourceWidth > 0 &&
        typeof params.sourceHeight === "number" && params.sourceHeight > 0
          ? { sourceWidth: params.sourceWidth, sourceHeight: params.sourceHeight }
          : {};
      const frame = hasDefaultImageFrame(image)
        ? defaultImageFrame(params.aspectRatio)
        : { frameWidth: image.frameWidth, frameHeight: image.frameHeight };
      const crop = image.crop ?? centeredCoverCrop(
        params.aspectRatio,
        frame.frameWidth / frame.frameHeight,
      );
      if (
        image.aspectRatio === params.aspectRatio &&
        image.sourceWidth === measuredSource.sourceWidth &&
        image.sourceHeight === measuredSource.sourceHeight &&
        image.crop !== undefined
      ) {
        return image;
      }
      imagesChanged = true;
      return {
        ...image,
        aspectRatio: params.aspectRatio,
        ...measuredSource,
        ...frame,
        crop,
      };
    });

    if (!imagesChanged) {
      return component;
    }
    changed = true;
    return { ...component, images };
  });

  return changed ? replace(plan, components) : plan;
}

export function moveImage(plan: ProjectPlan, params: MoveImageParams): ProjectPlan {
  const { fromComponentId, imageId, toComponentId, toIndex } = params;
  const source = plan.components.find(
    (component): component is ReferenceComponent =>
      component.type === "reference" && component.id === fromComponentId,
  );
  const target = plan.components.find(
    (component): component is ReferenceComponent =>
      component.type === "reference" && component.id === toComponentId,
  );
  if (!source || !target) {
    return plan;
  }

  const image = source.images.find((item) => item.id === imageId);
  if (!image) {
    return plan;
  }
  const sourceImages = source.images.filter((item) => item.id !== imageId);
  const base = fromComponentId === toComponentId ? sourceImages : target.images;
  const index = Math.max(0, Math.min(toIndex, base.length));
  const targetImages = [...base.slice(0, index), image, ...base.slice(index)];

  if (
    fromComponentId === toComponentId &&
    targetImages.length === source.images.length &&
    targetImages.every((item, position) => item.id === source.images[position].id)
  ) {
    return plan;
  }

  return replace(
    plan,
    plan.components.map((component) => {
      if (component.id === toComponentId && component.type === "reference") {
        return { ...component, images: targetImages };
      }
      if (component.id === fromComponentId && component.type === "reference") {
        return { ...component, images: sourceImages };
      }
      return component;
    }),
  );
}

export function moveImages(plan: ProjectPlan, params: MoveImagesParams): ProjectPlan {
  const requestedIds = new Set(params.imageIds);
  if (requestedIds.size === 0 || requestedIds.size !== params.imageIds.length) {
    return plan;
  }

  const selected = plan.components.flatMap((component) =>
    component.type === "reference"
      ? component.images.filter((image) => requestedIds.has(image.id))
      : [],
  );
  const target = plan.components.find(
    (component): component is ReferenceComponent =>
      component.type === "reference" && component.id === params.toComponentId,
  );
  if (!target || selected.length !== requestedIds.size) {
    return plan;
  }

  const componentsWithoutSelected = plan.components.map((component) =>
    component.type === "reference"
      ? {
          ...component,
          images: component.images.filter((image) => !requestedIds.has(image.id)),
        }
      : component,
  );
  const targetWithoutSelected = componentsWithoutSelected.find(
    (component): component is ReferenceComponent =>
      component.type === "reference" && component.id === params.toComponentId,
  );
  if (!targetWithoutSelected) {
    return plan;
  }

  const index = Math.max(0, Math.min(params.toIndex, targetWithoutSelected.images.length));
  const nextComponents = componentsWithoutSelected.map((component) =>
    component.type === "reference" && component.id === params.toComponentId
      ? {
          ...component,
          images: [
            ...component.images.slice(0, index),
            ...selected,
            ...component.images.slice(index),
          ],
        }
      : component,
  );
  const unchanged = nextComponents.every((component, componentIndex) => {
    const previous = plan.components[componentIndex];
    return (
      component === previous ||
      (component.type === "reference" &&
        previous?.type === "reference" &&
        component.images.length === previous.images.length &&
        component.images.every((image, imageIndex) => image.id === previous.images[imageIndex]?.id))
    );
  });

  return unchanged ? plan : replace(plan, nextComponents);
}

export function setImageFrame(
  plan: ProjectPlan,
  params: {
    componentId: string;
    imageId: string;
    frameWidth: number;
    frameHeight: number;
    frameOffsetX?: number;
    frameOffsetY?: number;
  },
): ProjectPlan {
  return mapReference(plan, params.componentId, (component) => {
    const target = component.images.find((image) => image.id === params.imageId);
    if (!target) {
      return component;
    }
    if (
      !Number.isFinite(params.frameWidth) ||
      params.frameWidth <= 0 ||
      !Number.isFinite(params.frameHeight) ||
      params.frameHeight <= 0 ||
      (params.frameOffsetX !== undefined && !Number.isFinite(params.frameOffsetX)) ||
      (params.frameOffsetY !== undefined && !Number.isFinite(params.frameOffsetY))
    ) {
      return component;
    }
    if (
      target.frameWidth === params.frameWidth &&
      target.frameHeight === params.frameHeight &&
      (target.frameOffsetX ?? 0) === (params.frameOffsetX ?? target.frameOffsetX ?? 0) &&
      (target.frameOffsetY ?? 0) === (params.frameOffsetY ?? target.frameOffsetY ?? 0)
    ) {
      return component;
    }
    return {
      ...component,
      images: component.images.map((image) =>
        image.id === params.imageId
          ? {
              ...image,
              frameWidth: params.frameWidth,
              frameHeight: params.frameHeight,
              frameOffsetX: params.frameOffsetX ?? image.frameOffsetX ?? 0,
              frameOffsetY: params.frameOffsetY ?? image.frameOffsetY ?? 0,
              crop: cropForResizedFrame(image, params),
            }
          : image,
      ),
    };
  });
}

export function setImageCrop(
  plan: ProjectPlan,
  params: {
    componentId: string;
    imageId: string;
    crop: NormalizedImageCrop;
  },
): ProjectPlan {
  const crop = normalizeImageCrop(params.crop);
  return mapReference(plan, params.componentId, (component) => {
    const target = component.images.find((image) => image.id === params.imageId);
    if (!target) return component;
    if (
      target.crop?.x === crop.x &&
      target.crop.y === crop.y &&
      target.crop.width === crop.width &&
      target.crop.height === crop.height
    ) {
      return component;
    }
    return {
      ...component,
      images: component.images.map((image) =>
        image.id === params.imageId ? { ...image, crop } : image
      ),
    };
  });
}

export function scaleReferenceImages(
  plan: ProjectPlan,
  params: { componentId: string; scale: number },
): ProjectPlan {
  if (!Number.isFinite(params.scale) || params.scale <= 0 || params.scale === 1) {
    return plan;
  }
  return mapReference(plan, params.componentId, (component) => {
    if (component.images.length === 0) {
      return component;
    }
    return {
      ...component,
      images: component.images.map((image) => ({
        ...image,
        frameWidth: Math.round(image.frameWidth * params.scale * 1000) / 1000,
        frameHeight: Math.round(image.frameHeight * params.scale * 1000) / 1000,
      })),
    };
  });
}
