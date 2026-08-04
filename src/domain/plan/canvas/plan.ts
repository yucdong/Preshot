import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  clampColumns,
  clampHeight,
  clampWidth,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
  type ReferenceImage,
  type WidthFraction,
} from "./models";

export interface MoveImageParams {
  fromComponentId: string;
  imageId: string;
  toComponentId: string;
  toIndex: number;
}

const MAX_HEIGHT = contentSize(DEFAULT_PAGE_GEOMETRY).height;

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
  return replace(plan, [...plan.components, component]);
}

export function removeComponent(plan: ProjectPlan, id: string): ProjectPlan {
  const components = plan.components.filter((component) => component.id !== id);
  return components.length === plan.components.length ? plan : replace(plan, components);
}

export function moveComponent(plan: ProjectPlan, params: { id: string; toIndex: number }): ProjectPlan {
  const current = plan.components.findIndex((component) => component.id === params.id);
  if (current === -1) {
    return plan;
  }
  const without = plan.components.filter((component) => component.id !== params.id);
  const index = Math.max(0, Math.min(params.toIndex, without.length));
  const next = [...without.slice(0, index), plan.components[current], ...without.slice(index)];
  const unchanged = next.every((component, position) => component.id === plan.components[position].id);
  return unchanged ? plan : replace(plan, next);
}

export function resizeComponent(
  plan: ProjectPlan,
  params: { id: string; widthFraction?: WidthFraction; width?: number; height?: number },
): ProjectPlan {
  return mapComponent(plan, params.id, (component) => {
    const widthFraction = params.widthFraction ?? component.widthFraction;
    const width = params.width !== undefined ? clampWidth(params.width) : component.width;
    const height = params.height === undefined ? component.height : clampHeight(params.height, MAX_HEIGHT);
    if (widthFraction === component.widthFraction && width === component.width && height === component.height) {
      return component;
    }
    return { ...component, widthFraction, width, height };
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
    component.title === title ? component : { ...component, title },
  );
}

export function setReferenceDescription(plan: ProjectPlan, id: string, description: string): ProjectPlan {
  return mapReference(plan, id, (component) =>
    component.description === description ? component : { ...component, description },
  );
}

export function setReferenceColumns(plan: ProjectPlan, id: string, columns: number): ProjectPlan {
  const clamped = clampColumns(columns);
  return mapReference(plan, id, (component) =>
    component.columnsPerRow === clamped ? component : { ...component, columnsPerRow: clamped },
  );
}

export function toggleReferenceCaptions(plan: ProjectPlan, id: string): ProjectPlan {
  return mapReference(plan, id, (component) => ({ ...component, showCaptions: !component.showCaptions }));
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
