import {
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  MIN_COLUMNS,
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
  return { id, title, columnsPerRow: clampColumns(columnsPerRow), images: [] };
}

export function findGroup(
  plan: ProjectPlan,
  groupId: string,
): ReferenceGroup | undefined {
  return plan.referenceGroups.find((group) => group.id === groupId);
}

export function addGroup(plan: ProjectPlan, group: ReferenceGroup): ProjectPlan {
  return {
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
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId ? { ...group, title } : group,
    ),
  };
}

export function deleteGroup(plan: ProjectPlan, groupId: string): ProjectPlan {
  return {
    referenceGroups: plan.referenceGroups.filter((group) => group.id !== groupId),
  };
}

export function setColumns(
  plan: ProjectPlan,
  groupId: string,
  columns: number,
): ProjectPlan {
  return {
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
    referenceGroups: plan.referenceGroups.map((group) =>
      group.id === groupId
        ? { ...group, images: group.images.filter((image) => image.id !== imageId) }
        : group,
    ),
  };
}
