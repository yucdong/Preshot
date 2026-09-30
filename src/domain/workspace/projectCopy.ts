import type { InspectedProject, RegisteredProjectIdentity, WorkspaceProjectView } from "./models";

export interface ProjectCopyRequest {
  operationId: string;
  sourcePath: string;
  sourceProjectId: string;
  parentPath: string;
  name: string;
}
export interface ProjectCopyStatus {
  operationId: string;
  phase: "copying" | "finishing" | "completed" | "failed" | "cancelled";
  copiedBytes: number;
  totalBytes: number;
  project: InspectedProject | null;
  error: string | null;
}
export interface PendingProjectCopy { request: ProjectCopyRequest; status: ProjectCopyStatus }
export interface ProjectCopyOperations {
  suggestProjectCopy(source: RegisteredProjectIdentity, baseName: string): Promise<{ parentPath: string; name: string }>;
  projectCopyStatus(operationId: string): Promise<ProjectCopyStatus | null>;
  cancelProjectCopy(operationId: string): Promise<void>;
  pendingProjectCopies(): Promise<PendingProjectCopy[]>;
  acknowledgeProjectCopy(operationId: string): Promise<void>;
}
export interface NativeProjectCopy extends ProjectCopyOperations {
  copyProject(input: ProjectCopyRequest): Promise<ProjectCopyStatus>;
}
export interface WorkspaceProjectCopy extends ProjectCopyOperations {
  copyProject(input: ProjectCopyRequest): Promise<WorkspaceProjectView>;
}
