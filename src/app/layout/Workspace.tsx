import { ProjectCanvasProvider, type CanvasPlanDependencies } from "../../features/plan/ProjectCanvasProvider";

interface WorkspaceProps {
  projectPath: string;
  projectName: string;
  dependencies: CanvasPlanDependencies;
}

export function Workspace({ projectPath, projectName, dependencies }: WorkspaceProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-stone-100 dark:bg-stone-800">
      <ProjectCanvasProvider dependencies={dependencies} projectName={projectName} projectPath={projectPath} />
    </main>
  );
}
