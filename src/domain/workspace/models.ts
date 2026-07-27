export type ProjectAvailability = "available" | "unavailable";

export interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  coverImage?: string;
}

export interface WorkspaceProjectRecord {
  projectId: string;
  path: string;
  name: string;
  coverImage: string | null;
  status: ProjectAvailability;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  readonly coverDataUrl?: never;
}

export type WorkspaceProjectView = Omit<
  WorkspaceProjectRecord,
  "coverDataUrl"
> & {
  coverDataUrl: string | null;
};

export interface WorkspaceMetadata {
  schemaVersion: 1;
  projects: WorkspaceProjectRecord[];
}

export interface InspectedProject {
  path: string;
  manifest: ProjectManifest;
  resolvedCoverImage: string | null;
  coverDataUrl: string | null;
}

export interface CreatedProject {
  project: InspectedProject;
  rollbackToken: string;
}

export const EMPTY_WORKSPACE: WorkspaceMetadata = {
  schemaVersion: 1,
  projects: [],
};
