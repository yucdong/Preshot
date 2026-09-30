import type { NativeProjectCopy, WorkspaceProjectCopy } from "./projectCopy";
import type {
  CreatedProject,
  InspectedProject,
  RegisteredProjectIdentity,
  UserDataBootstrapResult,
  UserDataRoots,
  WorkspaceMetadata,
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "./models";

export interface WorkspaceRegistry {
  load(): Promise<WorkspaceMetadata>;

  save(metadata: WorkspaceMetadata): Promise<void>;
}

export interface NativeWorkspace extends Partial<NativeProjectCopy> {
  ensureUserDataRoots(): Promise<UserDataRoots>;

  bootstrapUserData(
    registeredProjects: RegisteredProjectIdentity[],
  ): Promise<UserDataBootstrapResult>;

  createProject(parentPath: string, name: string): Promise<CreatedProject>;

  inspectProject(path: string): Promise<InspectedProject>;

  deleteProject(path: string, projectId: string): Promise<void>;

  rollbackCreatedProject(rollbackToken: string): Promise<void>;

  forgetCreatedProject(rollbackToken: string): Promise<void>;

  onMenuAction(
    handler: (action: WorkspaceMenuAction) => void,
  ): Promise<() => void>;
}

export interface DirectoryPickerOptions {
  defaultPath?: string;
  defaultToProjectsDir?: boolean;
}

export interface WorkspaceDirectoryPicker {
  getDefaultProjectsDirectory(): Promise<string>;
  pickDirectory(
    title: string,
    options?: DirectoryPickerOptions,
  ): Promise<string | null>;
}

export interface ProjectDirectoryRevealer {
  revealProjectDirectory(path: string): Promise<void>;
}

export interface WorkspaceClock {
  now(): string;
}

export interface WorkspaceLogger {
  debug(message: string, data?: Record<string, unknown>): void;

  info(message: string, data?: Record<string, unknown>): void;

  warn(message: string, data?: Record<string, unknown>): void;

  error(message: string, data?: Record<string, unknown>): void;
}

export type WorkspaceMenuAction = "new-project" | "open-project";

export interface WorkspaceService extends Partial<WorkspaceProjectCopy> {
  loadProjects(): Promise<WorkspaceProjectView[]>;

  createProject(
    parentPath: string,
    name: string,
  ): Promise<WorkspaceProjectView>;

  openProject(path: string): Promise<WorkspaceProjectView>;

  relocateProject(
    record: WorkspaceProjectRecord,
    path: string,
  ): Promise<WorkspaceProjectView>;

  removeRecord(projectId: string): Promise<WorkspaceProjectView[]>;

  deleteProject(project: RegisteredProjectIdentity): Promise<WorkspaceProjectView[]>;
}
