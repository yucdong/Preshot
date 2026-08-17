import type { ProjectPlanV13 } from "../canvas/blockDocument";

export interface BlockNotePlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlanV13): Promise<void>;
}
