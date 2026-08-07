import type { PlanComponent } from "../../../domain/plan/canvas/models";

export const IMAGE_GROUP_PREFIX = "imagegroup:";
const IMAGE_GROUP_FRAGMENT_SEPARATOR = "#";

export function imageGroupDroppableId(componentId: string, fragmentId?: string): string {
  if (fragmentId && !fragmentId.endsWith("::0")) {
    return `${IMAGE_GROUP_PREFIX}${componentId}${IMAGE_GROUP_FRAGMENT_SEPARATOR}${fragmentId}`;
  }

  return `${IMAGE_GROUP_PREFIX}${componentId}`;
}

function logicalComponentIdFromImageGroupDroppableId(overId: string): string {
  const raw = overId.slice(IMAGE_GROUP_PREFIX.length);
  const separatorIndex = raw.indexOf(IMAGE_GROUP_FRAGMENT_SEPARATOR);
  return separatorIndex === -1 ? raw : raw.slice(0, separatorIndex);
}

export interface ImageDropTarget {
  fromComponentId: string;
  toComponentId: string;
  toIndex: number;
}

export interface SelectedImageDropTarget {
  imageIds: string[];
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
    const toComponentId = logicalComponentIdFromImageGroupDroppableId(overId);
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

export function selectedImageDropTarget(
  components: PlanComponent[],
  activeImageId: string,
  selectedImageIds: ReadonlySet<string>,
  overId: string | null,
  insertAfter: boolean,
): SelectedImageDropTarget | null {
  if (overId === null) {
    return null;
  }

  const effectiveSelection = selectedImageIds.has(activeImageId)
    ? selectedImageIds
    : new Set([activeImageId]);
  const orderedIds = components.flatMap((component) =>
    component.type === "reference"
      ? component.images
          .filter((image) => effectiveSelection.has(image.id))
          .map((image) => image.id)
      : [],
  );
  if (orderedIds.length !== effectiveSelection.size || orderedIds.includes(overId)) {
    return null;
  }
  if (orderedIds.length === 1) {
    const singleTarget = imageDropTarget(
      components,
      activeImageId,
      overId,
      insertAfter,
    );
    return singleTarget
      ? {
          imageIds: orderedIds,
          toComponentId: singleTarget.toComponentId,
          toIndex: singleTarget.toIndex,
        }
      : null;
  }

  const toComponentId = overId.startsWith(IMAGE_GROUP_PREFIX)
    ? logicalComponentIdFromImageGroupDroppableId(overId)
    : components.find(
        (component) =>
          component.type === "reference" && component.images.some((image) => image.id === overId),
      )?.id;
  const target = components.find(
    (component) => component.type === "reference" && component.id === toComponentId,
  );
  if (!target || target.type !== "reference") {
    return null;
  }

  const base = target.images.filter((image) => !effectiveSelection.has(image.id));
  if (overId.startsWith(IMAGE_GROUP_PREFIX)) {
    return { imageIds: orderedIds, toComponentId: target.id, toIndex: base.length };
  }

  const overIndex = base.findIndex((image) => image.id === overId);
  if (overIndex === -1) {
    return null;
  }
  return {
    imageIds: orderedIds,
    toComponentId: target.id,
    toIndex: overIndex + (insertAfter ? 1 : 0),
  };
}
