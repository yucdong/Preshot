import type { ProjectPlan } from "./models";

export interface CanvasPlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlan): Promise<void>;
}
