import {
  defaultPersistedAgentModelSettings,
  normalizePersistedAgentModelSettings,
  type AgentModelSettingsStorePort,
} from "../../domain/agent";
import type { SettingsRepository } from "../../domain/settings/ports";

export function createSettingsAgentModelStore(
  repository: SettingsRepository,
): AgentModelSettingsStorePort {
  return {
    async load() {
      const settings = await repository.read();
      return settings.agentModel
        ? normalizePersistedAgentModelSettings(settings.agentModel)
        : defaultPersistedAgentModelSettings();
    },
    async save(agentModel) {
      const normalized = normalizePersistedAgentModelSettings(agentModel);
      const current = await repository.read();
      await repository.write({
        ...current,
        agentModel: normalized,
      });
    },
  };
}
