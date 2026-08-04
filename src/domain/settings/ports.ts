import type { AppSettings } from "./models";

export interface SettingsRepository {
  read(): Promise<AppSettings>;
  write(settings: AppSettings): Promise<void>;
}
