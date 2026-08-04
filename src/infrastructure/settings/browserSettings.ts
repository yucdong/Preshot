import type { SettingsRepository } from "../../domain/settings/ports";
import type { AppSettings } from "../../domain/settings/models";
import { DEFAULT_SETTINGS } from "../../domain/settings/models";

export function createBrowserSettingsRepository(): SettingsRepository {
  let current: AppSettings = { ...DEFAULT_SETTINGS };

  return {
    async read() {
      return { ...current };
    },
    async write(settings: AppSettings) {
      current = { ...settings };
    },
  };
}

export const browserSettingsRepository = createBrowserSettingsRepository();
