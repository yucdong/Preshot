import type { PlanComponent } from "../../../domain/plan/canvas/models";

export const IMAGE_GROUP_PREFIX = "imagegroup:";

export function imageGroupDroppableId(componentId: string): string {
  return `${IMAGE_GROUP_PREFIX}${componentId}`;
}

export interface ImageDropTarget {
  fromComponentId: string;
  toComponentId: string;
  toIndex: number;
}

export interface ImageDragRects {
  activeTranslated: { left: number; width: number } | null;
  over: { left: number; width: number } | null;
}

export function imageInsertAfterFromRects(
  active: ImageDragRects["activeTranslated"],
  over: ImageDragRects["over"],
): boolean {
  if (active === null || over === null) {
    return false;
  }
  const activeCenterX = active.left + active.width / 2;
  const overCenterX = over.left + over.width / 2;
  return activeCenterX > overCenterX;
}

export function imageDropTarget(
  components: PlanComponent[],
  activeImageId: string,
  overId: string | null,
  insertAfter: boolean,
): ImageDropTarget | null {
  if (overId === null || overId === activeImageId) {
    return null;
  }

  const fromComponent = components.find(
    (component) =>
      component.type === "reference" &&
      component.images.some((image) => image.id === activeImageId),
  );

  if (!fromComponent || fromComponent.type !== "reference") {
    return null;
  }

  if (overId.startsWith(IMAGE_GROUP_PREFIX)) {
    const toComponentId = overId.slice(IMAGE_GROUP_PREFIX.length);
    const toComponent = components.find(
      (component) => component.type === "reference" && component.id === toComponentId,
    );

    if (!toComponent || toComponent.type !== "reference") {
      return null;
    }

    const base =
      fromComponent.id === toComponentId
        ? toComponent.images.filter((image) => image.id !== activeImageId)
        : toComponent.images;

    return {
      fromComponentId: fromComponent.id,
      toComponentId,
      toIndex: base.length,
    };
  }

  const toComponent = components.find(
    (component) =>
      component.type === "reference" && component.images.some((image) => image.id === overId),
  );

  if (!toComponent || toComponent.type !== "reference") {
    return null;
  }

  if (toComponent.id === fromComponent.id) {
    const toIndex = toComponent.images.findIndex((image) => image.id === overId);
    return {
      fromComponentId: fromComponent.id,
      toComponentId: toComponent.id,
      toIndex,
    };
  } else {
    const overPos = toComponent.images.findIndex((image) => image.id === overId);
    if (overPos === -1) {
      return null;
    }
    const toIndex = overPos + (insertAfter ? 1 : 0);
    return {
      fromComponentId: fromComponent.id,
      toComponentId: toComponent.id,
      toIndex,
    };
  }
}
