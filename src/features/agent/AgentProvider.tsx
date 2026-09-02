import {
  type PropsWithChildren,
} from "react";
import type { AgentSessionController } from "../../domain/agent";
import { AgentControllerContext } from "./AgentContext";

interface AgentProviderProps extends PropsWithChildren {
  readonly controller: AgentSessionController;
}

export function AgentProvider({
  children,
  controller,
}: AgentProviderProps) {
  return (
    <AgentControllerContext.Provider value={controller}>
      {children}
    </AgentControllerContext.Provider>
  );
}
