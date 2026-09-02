import type { SettingsRepository } from "../domain/settings/ports";
import { browserSettingsRepository } from "../infrastructure/settings/browserSettings";
import { tauriSettingsRepository } from "../infrastructure/settings/tauriSettings";

export function createSettingsRepository(): SettingsRepository {
  if (
    import.meta.env.MODE === "test" ||
    import.meta.env.VITE_WORKSPACE_ADAPTER === "memory" ||
    import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene"
  ) {
    if (import.meta.env.PROD) {
      throw new Error(
        "The browser settings adapter is only available in test mode and must never run in a production build.",
      );
    }
    return browserSettingsRepository;
  }
  return tauriSettingsRepository;
}
