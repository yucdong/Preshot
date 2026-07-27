import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import {
  createWorkspaceDependencies,
  type WorkspaceDependencies,
} from "./workspace/dependencies";

const defaultWorkspaceDependencies = createWorkspaceDependencies();

interface AppProps {
  dependencies?: WorkspaceDependencies;
}

export function App({ dependencies = defaultWorkspaceDependencies }: AppProps) {
  return <WorkspaceProvider dependencies={dependencies} />;
}
