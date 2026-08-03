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
  return <WorkspaceProvider dependencies={dependencies} planDependencies={planDependencies} />;
}
