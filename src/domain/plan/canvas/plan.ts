import {
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
import { DOCUMENT_TITLE_HEIGHT, SPACING } from "./geometry";

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
  const belowExisting = Math.max(
    DOCUMENT_TITLE_HEIGHT + SPACING,
    ...plan.components.map((entry) => entry.y + entry.height + SPACING),
  );
  const rect = clampCardRect(
    {
      x: 0,
      y: belowExisting,
      width: component.width,
      height: component.height,
    },
    canvasWidth,
  );
  return replace(plan, [...plan.components, { ...component, ...rect }]);
}

export function removeComponent(plan: ProjectPlan, id: string): ProjectPlan {
  const components = plan.components.filter((component) => component.id !== id);
  return components.length === plan.components.length ? plan : replace(plan, components);
}

export function moveComponent(
  plan: ProjectPlan,
  params: { id: string } & ComponentMoveTarget,
): ProjectPlan {
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  return mapComponent(plan, params.id, (component) => {
    const next = moveCard(component, params, canvasWidth);
    return next.x === component.x && next.y === component.y
      ? component
      : { ...component, ...next };
  });
}

export function resizeComponent(
  plan: ProjectPlan,
  params: {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  },
): ProjectPlan {
  const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;
  return mapComponent(plan, params.id, (component) => {
    const resized = resizeCard(
      {
        ...component,
        x: params.x ?? component.x,
        y: params.y ?? component.y,
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
      resized.y === component.y &&
      resized.width === component.width &&
      resized.height === component.height
    ) {
      return component;
    }
    return { ...component, ...resized };
  });
}

export function updatePlanHtml(plan: ProjectPlan, params: { id: string; html: string }): ProjectPlan {
  return mapComponent(plan, params.id, (component) =>
    component.type === "plan" && component.html !== params.html
      ? { ...component, html: params.html }
      : component,
  );
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
  params: { file: string; aspectRatio: number },
): ProjectPlan {
  let changed = false;
  const components = plan.components.map((component) => {
    if (component.type !== "reference") {
      return component;
    }

    let imagesChanged = false;
    const images = component.images.map((image) => {
      if (image.file !== params.file || image.aspectRatio === params.aspectRatio) {
        return image;
      }
      imagesChanged = true;
      return { ...image, aspectRatio: params.aspectRatio };
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
      params.frameHeight <= 0
    ) {
      return component;
    }
    if (
      target.frameWidth === params.frameWidth &&
      target.frameHeight === params.frameHeight
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
            }
          : image,
      ),
    };
  });
}
