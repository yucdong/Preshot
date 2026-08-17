import { createContext, useContext } from "react";
import type { Theme } from "../../domain/settings/models";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
  projectRailWidth: number;
  assistantWidth: number;
  setPanelWidths: (widths: {
    projectRailWidth: number;
    assistantWidth: number;
  }) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
