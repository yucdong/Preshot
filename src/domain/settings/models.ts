export type Theme = "light" | "dark" | "system";

export const PROJECT_RAIL_WIDTH = { default: 192, min: 176, max: 320 } as const;
export const ASSISTANT_WIDTH = { default: 272, min: 240, max: 420 } as const;
const LEGACY_DEFAULT_PANEL_WIDTHS = { projectRailWidth: 208, assistantWidth: 304 };

export interface AppSettings {
  theme: Theme;
  projectRailWidth?: number;
  assistantWidth?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  projectRailWidth: PROJECT_RAIL_WIDTH.default,
  assistantWidth: ASSISTANT_WIDTH.default,
};

function isValidTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function normalizeSettings(raw: unknown): AppSettings {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const hasLegacyDefaultPanelWidths =
    record.projectRailWidth === LEGACY_DEFAULT_PANEL_WIDTHS.projectRailWidth &&
    record.assistantWidth === LEGACY_DEFAULT_PANEL_WIDTHS.assistantWidth;
  const clamp = (value: unknown, range: { default: number; min: number; max: number }) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(range.max, Math.max(range.min, Math.round(value)))
      : range.default;
  return {
    theme: isValidTheme(record.theme) ? record.theme : "system",
    projectRailWidth: hasLegacyDefaultPanelWidths
      ? PROJECT_RAIL_WIDTH.default
      : clamp(record.projectRailWidth, PROJECT_RAIL_WIDTH),
    assistantWidth: hasLegacyDefaultPanelWidths
      ? ASSISTANT_WIDTH.default
      : clamp(record.assistantWidth, ASSISTANT_WIDTH),
  };
}
