import type { ProjectPlan } from "./models";

export interface CanvasPlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}

export interface PdfSaveTarget {
  save(bytes: Uint8Array, suggestedName: string): Promise<boolean>;
}

export interface PdfRevealTarget {
  reveal(path: string): Promise<void>;
}
