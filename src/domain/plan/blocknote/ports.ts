import type { ProjectPlanV15 } from "../canvas/blockDocument";

export interface BlockNotePlanRepository {
  loadRawPlan(projectPath: string): Promise<unknown>;
  saveRawPlan(projectPath: string, plan: ProjectPlanV15): Promise<void>;
}
