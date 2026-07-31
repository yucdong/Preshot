import type { MoveImageParams, ReferenceGroup } from "../../domain/plan/models";

const GROUP_PREFIX = "group:";

export function groupDroppableId(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`;
}

export function resolveImageMove(
  groups: ReferenceGroup[],
  activeId: string,
  overId: string | null,
): MoveImageParams | null {
  if (overId === null || overId === activeId) {
    return null;
  }

  const fromGroup = groups.find((group) => group.images.some((image) => image.id === activeId));
  if (!fromGroup) {
    return null;
  }

  let toGroupId: string;
  let toIndex: number;

  if (overId.startsWith(GROUP_PREFIX)) {
    toGroupId = overId.slice(GROUP_PREFIX.length);
    const target = groups.find((group) => group.id === toGroupId);
    if (!target) {
      return null;
    }
    toIndex = target.images.length;
  } else {
    const target = groups.find((group) => group.images.some((image) => image.id === overId));
    if (!target) {
      return null;
    }
    toGroupId = target.id;
    toIndex = target.images.findIndex((image) => image.id === overId);
  }

  if (fromGroup.id === toGroupId) {
    const fromIndex = fromGroup.images.findIndex((image) => image.id === activeId);
    if (fromIndex === toIndex) {
      return null;
    }
  }

  return { fromGroupId: fromGroup.id, imageId: activeId, toGroupId, toIndex };
}

export function handleImageDragEnd(
  groups: ReferenceGroup[],
  event: { active: { id: string | number }; over: { id: string | number } | null },
  onMoveImage: (params: MoveImageParams) => void,
): void {
  const params = resolveImageMove(
    groups,
    String(event.active.id),
    event.over ? String(event.over.id) : null,
  );
  if (params) {
    onMoveImage(params);
  }
}
