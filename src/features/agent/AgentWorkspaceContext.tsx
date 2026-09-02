import {
  type PropsWithChildren,
} from "react";
import type {
  AgentWorkspaceReader,
} from "../../domain/agent/workspaceBridge";
import { AgentWorkspaceContext } from "./useAgentWorkspace";

interface AgentWorkspaceProviderProps extends PropsWithChildren {
  readonly store: AgentWorkspaceReader;
}

export function AgentWorkspaceProvider({
  children,
  store,
}: AgentWorkspaceProviderProps) {
  return (
    <AgentWorkspaceContext.Provider value={store}>
      {children}
    </AgentWorkspaceContext.Provider>
  );
}
