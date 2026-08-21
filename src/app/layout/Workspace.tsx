import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import type { ProjectDirectoryRevealer } from "../../domain/workspace/ports";
import { BlockNoteProjectCanvasProvider } from "../../features/plan/blocknote/BlockNoteProjectCanvasProvider";

interface WorkspaceProps {
  projectPath: string;
  projectName: string;
  dependencies: PlanDependencies;
  projectDirectoryRevealer: ProjectDirectoryRevealer;
}

export function Workspace({
  projectPath,
  projectName,
  dependencies,
  projectDirectoryRevealer,
}: WorkspaceProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-app-bg">
      <BlockNoteProjectCanvasProvider
        docxExporter={dependencies.docxExporter}
        docxSaver={dependencies.docxSaver}
        exporter={dependencies.exporter}
        longImageExporter={dependencies.longImageExporter}
        longImageSaver={dependencies.longImageSaver}
        key={projectPath}
        logger={dependencies.logger}
        projectName={projectName}
        projectPath={projectPath}
        picker={dependencies.picker}
        projectDirectoryRevealer={projectDirectoryRevealer}
        saver={dependencies.saver}
        screenCapture={dependencies.screenCapture}
        service={dependencies.service}
      />
    </main>
  );
}
