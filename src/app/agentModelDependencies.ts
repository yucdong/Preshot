import { AgentModelSettingsController } from "../domain/agent";
import type { SettingsRepository } from "../domain/settings/ports";
import { browserAgentModelProbe } from "../infrastructure/agent/browserAgentModelProbe";
import { createSettingsAgentModelStore } from "../infrastructure/agent/settingsAgentModelStore";
import { tauriAgentModelProbe } from "../infrastructure/agent/tauriAgentModelProbe";

export function createAgentModelSettingsController(
  settingsRepository: SettingsRepository,
): AgentModelSettingsController {
  const useBrowserAdapter =
    import.meta.env.MODE === "test" ||
    import.meta.env.VITE_WORKSPACE_ADAPTER === "memory" ||
    import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene";
  if (useBrowserAdapter && import.meta.env.PROD) {
    throw new Error(
      "The browser agent model adapter is only available in test mode and must never run in a production build.",
    );
  }
  return new AgentModelSettingsController({
    store: createSettingsAgentModelStore(settingsRepository),
    probe: useBrowserAdapter ? browserAgentModelProbe : tauriAgentModelProbe,
  });
}
