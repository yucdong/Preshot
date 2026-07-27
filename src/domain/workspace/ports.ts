import type {
  InspectedProject,
  WorkspaceMetadata,
  WorkspaceProjectRecord,
} from "./models";

export interface WorkspaceRegistry {
  load(): Promise<WorkspaceMetadata>;

  save(metadata: WorkspaceMetadata): Promise<void>;
}

export interface NativeWorkspace {
  createProject(parentPath: string, name: string): Promise<InspectedProject>;

  inspectProject(path: string): Promise<InspectedProject>;

  removeCreatedProject(path: string, projectId: string): Promise<void>;

  onMenuAction(
    handler: (action: WorkspaceMenuAction) => void,
  ): Promise<() => void>;
}

export interface WorkspaceDirectoryPicker {
  pickDirectory(title: string): Promise<string | null>;
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
  loadProjects(): Promise<WorkspaceProjectRecord[]>;

  createProject(
    parentPath: string,
    name: string,
  ): Promise<WorkspaceProjectRecord>;

  openProject(path: string): Promise<WorkspaceProjectRecord>;

  relocateProject(
    record: WorkspaceProjectRecord,
    path: string,
  ): Promise<WorkspaceProjectRecord>;

  removeRecord(projectId: string): Promise<WorkspaceProjectRecord[]>;
}
