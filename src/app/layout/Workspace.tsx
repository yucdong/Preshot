import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import { BlockNoteProjectCanvasProvider } from "../../features/plan/blocknote/BlockNoteProjectCanvasProvider";

interface WorkspaceProps {
  projectPath: string;
  projectName: string;
  dependencies: PlanDependencies;
}

export function Workspace({ projectPath, projectName, dependencies }: WorkspaceProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-app-bg">
      <BlockNoteProjectCanvasProvider
        exporter={dependencies.exporter}
        key={projectPath}
        projectName={projectName}
        projectPath={projectPath}
        picker={dependencies.picker}
        saver={dependencies.saver}
        screenCapture={dependencies.screenCapture}
        service={dependencies.service}
      />
    </main>
  );
}
