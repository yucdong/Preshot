import {
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  MIN_COLUMNS,
  type MoveImageParams,
  type ProjectPlan,
  type ReferenceGroup,
  type ReferenceImage,
} from "./models";

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) {
    return MIN_COLUMNS;
  }
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns)));
}

export function createGroup(
  id: string,
  title: string,
  columnsPerRow: number = DEFAULT_COLUMNS,
): ReferenceGroup {
  return { id, title, description: "", columnsPerRow: clampColumns(columnsPerRow), images: [] };
}

export function findGroup(
  plan: ProjectPlan,
  groupId: string,
): ReferenceGroup | undefined {
  return plan.referenceGroups.find((group) => group.id === groupId);
}

export function addGroup(plan: ProjectPlan, group: ReferenceGroup): ProjectPlan {
  return {
    ...plan,
    referenceGroups: [
      ...plan.referenceGroups,
      { ...group, columnsPerRow: clampColumns(group.columnsPerRow) },
    ],
  };
}

export function renameGroup(
  plan: ProjectPlan,
  groupId: string,
  title: string,
): ProjectPlan {
  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId ? { ...group, title } : group,
    ),
  };
}

export function setDescription(
  plan: ProjectPlan,
  groupId: string,
  description: string,
): ProjectPlan {
  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId ? { ...group, description } : group,
    ),
  };
}

export function setPhotographyPlan(plan: ProjectPlan, html: string): ProjectPlan {
  return { ...plan, photographyPlan: html };
}

export function deleteGroup(plan: ProjectPlan, groupId: string): ProjectPlan {
  return {
    ...plan,
    referenceGroups: plan.referenceGroups.filter((group) => group.id !== groupId),
  };
}

export function setColumns(
  plan: ProjectPlan,
  groupId: string,
  columns: number,
): ProjectPlan {
  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, columnsPerRow: clampColumns(columns) }
        : group,
    ),
  };
}

export function addImage(
  plan: ProjectPlan,
  groupId: string,
  image: ReferenceImage,
): ProjectPlan {
  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, images: [...group.images, image] }
        : group,
    ),
  };
}

export function removeImage(
  plan: ProjectPlan,
  groupId: string,
  imageId: string,
): ProjectPlan {
  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, images: group.images.filter((image) => image.id !== imageId) }
        : group,
    ),
  };
}

export function moveImage(plan: ProjectPlan, params: MoveImageParams): ProjectPlan {
  const { fromGroupId, imageId, toGroupId, toIndex } = params;
  const source = findGroup(plan, fromGroupId);
  const target = findGroup(plan, toGroupId);
  if (!source || !target) {
    return plan;
  }
  const image = source.images.find((item) => item.id === imageId);
  if (!image) {
    return plan;
  }

  const sourceImages = source.images.filter((item) => item.id !== imageId);
  const base = fromGroupId === toGroupId ? sourceImages : target.images;
  const index = Math.max(0, Math.min(toIndex, base.length));
  const targetImages = [...base.slice(0, index), image, ...base.slice(index)];

  if (
    fromGroupId === toGroupId &&
    targetImages.length === source.images.length &&
    targetImages.every((item, position) => item.id === source.images[position].id)
  ) {
    return plan;
  }

  return {
    ...plan,
    referenceGroups: plan.referenceGroups.map((group) => {
      if (group.id === toGroupId) {
        return { ...group, images: targetImages };
      }
      if (group.id === fromGroupId) {
        return { ...group, images: sourceImages };
      }
      return group;
    }),
  };
}
