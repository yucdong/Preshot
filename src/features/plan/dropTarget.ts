import type { MoveImageParams, ReferenceGroup } from "../../domain/plan/models";

export const GROUP_PREFIX = "group:";

export function groupDroppableId(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`;
}

export type DropTarget = Pick<MoveImageParams, "toGroupId" | "toIndex">;

export function computeDropTarget(
  groups: ReferenceGroup[],
  activeId: string,
  overId: string | null,
  insertAfter: boolean,
): DropTarget | null {
  if (overId === null || overId === activeId) {
    return null;
  }
  const fromGroup = groups.find((group) => group.images.some((image) => image.id === activeId));
  if (!fromGroup) {
    return null;
  }

  if (overId.startsWith(GROUP_PREFIX)) {
    const toGroupId = overId.slice(GROUP_PREFIX.length);
    const target = groups.find((group) => group.id === toGroupId);
    if (!target) {
      return null;
    }
    const withoutActive = target.images.filter((image) => image.id !== activeId);
    return { toGroupId, toIndex: withoutActive.length };
  }

  const target = groups.find((group) => group.images.some((image) => image.id === overId));
  if (!target) {
    return null;
  }

  if (target.id === fromGroup.id) {
    // Same group: move the active image into the over tile's slot as soon as it
    // becomes the drop target (array-move semantics). A drag then only needs to
    // overlap a neighbour most, not travel past its centre, so `insertAfter` is
    // unused here. moveImage removes the active image first, so inserting at the
    // over tile's original index reproduces arrayMove(activeIndex, overIndex).
    return { toGroupId: target.id, toIndex: target.images.findIndex((image) => image.id === overId) };
  }

  const overPos = target.images.findIndex((image) => image.id === overId);
  if (overPos === -1) {
    return null;
  }
  return { toGroupId: target.id, toIndex: overPos + (insertAfter ? 1 : 0) };
}

export interface DropRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DropDragEvent {
  active: { id: string | number; rect: { current: { translated: DropRect | null } } };
  over: { id: string | number; rect: DropRect } | null;
}

export function dropTargetFromEvent(groups: ReferenceGroup[], event: DropDragEvent): DropTarget | null {
  const activeId = String(event.active.id);
  const overId = event.over ? String(event.over.id) : null;
  const activeRect = event.active.rect.current.translated;
  const overRect = event.over?.rect ?? null;
  const insertAfter =
    activeRect != null && overRect != null
      ? activeRect.left + activeRect.width / 2 > overRect.left + overRect.width / 2
      : false;
  return computeDropTarget(groups, activeId, overId, insertAfter);
}
