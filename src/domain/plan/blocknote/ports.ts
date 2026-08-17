import type { ProjectPlanV14 } from "../canvas/blockDocument";

export interface BlockNotePlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlanV14): Promise<void>;
}
