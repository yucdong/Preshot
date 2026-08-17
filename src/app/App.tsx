import { ThemeProvider } from "./theme/ThemeProvider";
import { createSettingsRepository } from "./settingsDependencies";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import {
  createWorkspaceDependencies,
  type WorkspaceDependencies,
} from "./workspace/dependencies";
import { createPlanDependencies } from "./plan/planDependencies";
import type { PlanDependencies } from "../features/plan/blocknote/dependencies";

const defaultWorkspaceDependencies = createWorkspaceDependencies();
const defaultPlanDependencies = createPlanDependencies();
const settingsRepository = createSettingsRepository();

interface AppProps {
  dependencies?: WorkspaceDependencies;
  planDependencies?: PlanDependencies;
}

export function App({
  dependencies = defaultWorkspaceDependencies,
  planDependencies = defaultPlanDependencies,
}: AppProps) {
  return (
    <ThemeProvider repository={settingsRepository}>
      <WorkspaceProvider dependencies={dependencies} planDependencies={planDependencies} />
    </ThemeProvider>
  );
}
