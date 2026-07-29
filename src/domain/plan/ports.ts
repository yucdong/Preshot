import type { ImportedImage, ProjectPlan } from "./models";

export interface PlanRepository {
  loadPlan(projectPath: string): Promise<ProjectPlan>;
  savePlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}

export interface ReferenceImageStore {
  importImage(projectPath: string, sourcePath: string): Promise<ImportedImage>;
  loadImage(projectPath: string, file: string): Promise<string>;
  removeImage(projectPath: string, file: string): Promise<void>;
}

export interface PlanImagePicker {
  pickImageFile(title: string): Promise<string | null>;
}
