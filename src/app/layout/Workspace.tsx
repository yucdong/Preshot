import { ProjectPlanProvider, type PlanDependencies } from "../../features/plan/ProjectPlanProvider";

interface WorkspaceProps {
  projectPath: string;
  dependencies: PlanDependencies;
}

export function Workspace({ projectPath, dependencies }: WorkspaceProps) {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-stone-100">
      <ProjectPlanProvider dependencies={dependencies} projectPath={projectPath} />
    </main>
  );
}
