import { invoke } from "@tauri-apps/api/core";
import type { SettingsRepository } from "../../domain/settings/ports";
import type { AppSettings } from "../../domain/settings/models";
import { normalizeSettings } from "../../domain/settings/models";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

interface Dependencies {
  invokeCommand?: InvokeCommand;
}

function detail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createTauriSettingsRepository({
  invokeCommand = invoke,
}: Dependencies = {}): SettingsRepository {
  return {
    async read() {
      try {
        const raw = await invokeCommand("read_settings");
        return normalizeSettings(raw);
      } catch (error) {
        throw new Error(`Unable to read settings: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async write(settings: AppSettings) {
      try {
        await invokeCommand("write_settings", {
          value: normalizeSettings(settings),
        });
      } catch (error) {
        throw new Error(`Unable to write settings: ${detail(error)}`, {
          cause: error,
        });
      }
    },
  };
}

export const tauriSettingsRepository = createTauriSettingsRepository();
