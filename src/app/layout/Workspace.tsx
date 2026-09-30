import { useCallback } from "react";
import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import type { ProjectDirectoryRevealer } from "../../domain/workspace/ports";
import { BlockNoteProjectCanvasProvider } from "../../features/plan/blocknote/BlockNoteProjectCanvasProvider";
import type { PlanLoadProgress } from "../../features/plan/blocknote/planLoadProgress";

interface WorkspaceProps {
  active?: boolean;
  interactionPaused?: boolean;
  savePaused?: boolean;
  registerBeforeClose?(path: string, flush: (saveChanges?: boolean) => Promise<void>): () => void;
  registerBeforeCopy?(path: string, prepare: () => Promise<() => void>): () => void;
  loadId: number;
  onLoadProgress?(loadId: number, projectPath: string, progress: PlanLoadProgress): void;
  projectPath: string;
  projectId: string;
  projectName: string;
  dependencies: PlanDependencies;
  projectDirectoryRevealer: ProjectDirectoryRevealer;
}

export function Workspace({
  active = true,
  interactionPaused = false,
  savePaused = false,
  registerBeforeClose,
  registerBeforeCopy,
  loadId,
  onLoadProgress,
  projectPath,
  projectId,
  projectName,
  dependencies,
  projectDirectoryRevealer,
}: WorkspaceProps) {
  const reportProgress = useCallback((path: string, progress: PlanLoadProgress) => {
    onLoadProgress?.(loadId, path, progress);
  }, [loadId, onLoadProgress]);
  return (
    <main hidden={!active} inert={!active} style={!active ? { display: "none" } : undefined} className="flex min-h-0 min-w-0 flex-1 flex-col bg-app-bg">
      <BlockNoteProjectCanvasProvider
        active={active && !interactionPaused}
        savePaused={savePaused}
        registerBeforeClose={registerBeforeClose}
        registerBeforeCopy={registerBeforeCopy}
        onLoadProgress={reportProgress}
        docxExporter={dependencies.docxExporter}
        docxSaver={dependencies.docxSaver}
        exporter={dependencies.exporter}
        longImageExporter={dependencies.longImageExporter}
        longImageSaver={dependencies.longImageSaver}
        key={`${projectPath}:${loadId}`}
        logger={dependencies.logger}
        projectName={projectName}
        projectId={projectId}
        projectPath={projectPath}
        picker={dependencies.picker}
        projectDirectoryRevealer={projectDirectoryRevealer}
        saver={dependencies.saver}
        screenCapture={dependencies.screenCapture}
        service={dependencies.service}
        imagePasteRepository={dependencies.imagePasteRepository}
      />
    </main>
  );
}
