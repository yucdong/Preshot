import {
  createContext,
  useContext,
  useSyncExternalStore,
} from "react";
import type {
  AgentSessionController,
  AgentSessionControllerState,
} from "../../domain/agent";

export const AgentControllerContext =
  createContext<AgentSessionController | null>(null);

export function useAgentController(): AgentSessionController {
  const controller = useContext(AgentControllerContext);
  if (!controller) {
    throw new Error("useAgentController must be used within AgentProvider");
  }
  return controller;
}

export function useOptionalAgentController(): AgentSessionController | null {
  return useContext(AgentControllerContext);
}

export function useAgentControllerState(): AgentSessionControllerState {
  const controller = useAgentController();
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}
