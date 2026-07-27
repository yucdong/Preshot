import type { Project } from "./models";

export interface ProjectRepository {
  load(path: string): Promise<Project>;
  save(path: string, project: Project): Promise<void>;
}

export interface PdfExportOptions {
  destinationPath: string;
  title: string;
}

export interface PdfExporter {
  export(project: Project, options: PdfExportOptions): Promise<void>;
}

export interface DesktopFileSystem {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
}
