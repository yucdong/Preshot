export type Theme = "light" | "dark" | "system";

export interface AppSettings {
  theme: Theme;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
};

function isValidTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function normalizeSettings(raw: unknown): AppSettings {
  if (
    raw &&
    typeof raw === "object" &&
    "theme" in raw &&
    isValidTheme(raw.theme)
  ) {
    return { theme: raw.theme };
  }
  return { ...DEFAULT_SETTINGS };
}
