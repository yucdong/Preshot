import type {
  CreatedProject,
  InspectedProject,
  WorkspaceMetadata,
  WorkspaceProjectRecord,
  WorkspaceProjectView,
} from "./models";

export interface WorkspaceRegistry {
  load(): Promise<WorkspaceMetadata>;

  save(metadata: WorkspaceMetadata): Promise<void>;
}

export interface NativeWorkspace {
  createProject(parentPath: string, name: string): Promise<CreatedProject>;

  inspectProject(path: string): Promise<InspectedProject>;

  rollbackCreatedProject(rollbackToken: string): Promise<void>;

  forgetCreatedProject(rollbackToken: string): Promise<void>;

  onMenuAction(
    handler: (action: WorkspaceMenuAction) => void,
  ): Promise<() => void>;
}

export interface DirectoryPickerOptions {
  defaultToProjectsDir?: boolean;
}

export interface WorkspaceDirectoryPicker {
  pickDirectory(
    title: string,
    options?: DirectoryPickerOptions,
  ): Promise<string | null>;
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

export interface WorkspaceService {
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
}
