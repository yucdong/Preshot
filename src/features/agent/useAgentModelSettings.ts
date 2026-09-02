import { createContext, useContext } from "react";
import type {
  AgentModelSettingsController,
  AgentModelSettingsSnapshot,
} from "../../domain/agent";

export interface AgentModelSettingsContextValue {
  readonly controller: AgentModelSettingsController;
  readonly snapshot: AgentModelSettingsSnapshot;
  readonly settingsOpen: boolean;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
}

export const AgentModelSettingsContext =
  createContext<AgentModelSettingsContextValue | null>(null);

export function useAgentModelSettings(): AgentModelSettingsContextValue {
  const context = useContext(AgentModelSettingsContext);
  if (!context) {
    throw new Error(
      "useAgentModelSettings must be used within AgentModelSettingsProvider",
    );
  }
  return context;
}
