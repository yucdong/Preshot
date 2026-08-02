import { ProjectPlanProvider, type PlanDependencies } from "../../features/plan/ProjectPlanProvider";

interface WorkspaceProps {
  projectPath: string;
  projectName: string;
  dependencies: PlanDependencies;
}

export function Workspace({ projectPath, projectName, dependencies }: WorkspaceProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-stone-100">
      <ProjectPlanProvider dependencies={dependencies} projectName={projectName} projectPath={projectPath} />
    </main>
  );
}
