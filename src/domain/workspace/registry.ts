import type {
  InspectedProject,
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "./models";

type SortableProject = {
  lastOpenedAt: string;
};

export function sortProjects<T extends SortableProject>(
  projects: T[],
): T[] {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const openedAtOrder = right.project.lastOpenedAt.localeCompare(
        left.project.lastOpenedAt,
      );

      if (openedAtOrder !== 0) {
        return openedAtOrder;
      }

      return left.index - right.index;
    })
    .map(({ project }) => project);
}

export function upsertProject(
  projects: WorkspaceProjectView[],
  project: WorkspaceProjectView,
): WorkspaceProjectView[] {
  const nextProjects = [
    ...projects.filter(({ projectId }) => projectId !== project.projectId),
    project,
  ];

  return sortProjects(nextProjects);
}

export function markProjectUnavailable(
  project: WorkspaceProjectRecord | WorkspaceProjectView,
): WorkspaceProjectView {
  return {
    ...project,
    status: "unavailable",
    coverDataUrl: null,
  };
}

export function inspectedToProject(
  inspected: InspectedProject,
  lastOpenedAt: string,
): WorkspaceProjectView {
  return {
    projectId: inspected.manifest.id,
    path: inspected.path,
    name: inspected.manifest.name,
    coverImage: inspected.resolvedCoverImage,
    coverDataUrl: inspected.coverDataUrl,
    status: "available",
    createdAt: inspected.manifest.createdAt,
    updatedAt: inspected.manifest.updatedAt,
    lastOpenedAt,
  };
}

export function relocateProject(
  current: WorkspaceProjectRecord | WorkspaceProjectView,
  replacement: WorkspaceProjectView,
): WorkspaceProjectView {
  if (current.projectId !== replacement.projectId) {
    throw new Error("Selected folder belongs to a different Preshot project");
  }

  return replacement;
}
