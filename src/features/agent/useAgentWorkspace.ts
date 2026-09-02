import {
  createContext,
  useContext,
  useSyncExternalStore,
} from "react";
import type {
  AgentWorkspaceReader,
} from "../../domain/agent/workspaceBridge";

export const AgentWorkspaceContext =
  createContext<AgentWorkspaceReader | null>(null);

export function useAgentWorkspace(): AgentWorkspaceReader {
  const store = useContext(AgentWorkspaceContext);
  if (!store) {
    throw new Error(
      "useAgentWorkspace must be used within AgentWorkspaceProvider",
    );
  }
  return store;
}

export function useAgentWorkspaceSnapshot() {
  const store = useAgentWorkspace();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
