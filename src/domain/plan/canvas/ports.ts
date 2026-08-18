import type { ProjectPlan } from "./models";

export interface CanvasPlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}

export interface DocumentSaveOptions {
  suggestedName: string;
  defaultDirectory: string;
}

export interface DocumentSaveTarget {
  revealProjectDirectoryAfterSave?: boolean;
  save(bytes: Uint8Array, options: DocumentSaveOptions): Promise<string | null>;
}

export type PdfSaveOptions = DocumentSaveOptions;
export type PdfSaveTarget = DocumentSaveTarget;
export type DocxSaveOptions = DocumentSaveOptions;
export type DocxSaveTarget = DocumentSaveTarget;
