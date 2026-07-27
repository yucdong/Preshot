import type {
  InspectedProject,
  WorkspaceProjectRecord,
} from "./models";

export function sortProjects(
  projects: WorkspaceProjectRecord[],
): WorkspaceProjectRecord[] {
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
  projects: WorkspaceProjectRecord[],
  project: WorkspaceProjectRecord,
): WorkspaceProjectRecord[] {
  const hasProject = projects.some(({ projectId }) => projectId === project.projectId);
  const nextProjects = hasProject
    ? projects.map((current) =>
        current.projectId === project.projectId ? project : current,
      )
    : [...projects, project];

  return sortProjects(nextProjects);
}

export function markProjectUnavailable(
  project: WorkspaceProjectRecord,
): WorkspaceProjectRecord {
  return {
    ...project,
    status: "unavailable",
    coverDataUrl: null,
  };
}

export function inspectedToRecord(
  inspected: InspectedProject,
  lastOpenedAt: string,
): WorkspaceProjectRecord {
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
  current: WorkspaceProjectRecord,
  replacement: WorkspaceProjectRecord,
): WorkspaceProjectRecord {
  if (current.projectId !== replacement.projectId) {
    throw new Error("Selected folder belongs to a different Preshot project");
  }

  return replacement;
}
