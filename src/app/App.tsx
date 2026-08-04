import { ThemeProvider } from "./theme/ThemeProvider";
import { tauriSettingsRepository } from "../infrastructure/settings/tauriSettings";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import {
  createWorkspaceDependencies,
  type WorkspaceDependencies,
} from "./workspace/dependencies";
import { createPlanDependencies } from "./plan/planDependencies";
import type { CanvasPlanDependencies } from "../features/plan/ProjectCanvasProvider";

const defaultWorkspaceDependencies = createWorkspaceDependencies();
const defaultPlanDependencies = createPlanDependencies();

interface AppProps {
  dependencies?: WorkspaceDependencies;
  planDependencies?: CanvasPlanDependencies;
}

export function App({
  dependencies = defaultWorkspaceDependencies,
  planDependencies = defaultPlanDependencies,
}: AppProps) {
  return (
    <ThemeProvider repository={tauriSettingsRepository}>
      <WorkspaceProvider dependencies={dependencies} planDependencies={planDependencies} />
    </ThemeProvider>
  );
}
