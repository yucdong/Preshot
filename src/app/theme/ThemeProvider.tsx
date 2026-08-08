import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SettingsRepository } from "../../domain/settings/ports";
import {
  ASSISTANT_WIDTH,
  DEFAULT_SETTINGS,
  PROJECT_RAIL_WIDTH,
  normalizeSettings,
  type AppSettings,
  type Theme,
} from "../../domain/settings/models";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
  projectRailWidth: number;
  assistantWidth: number;
  setPanelWidths: (widths: { projectRailWidth: number; assistantWidth: number }) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  repository: SettingsRepository;
  children: ReactNode;
}

export function ThemeProvider({ repository, children }: ThemeProviderProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const theme = settings.theme;

  // Load theme from repository on mount
  useEffect(() => {
    repository
      .read()
      .then((settings) => {
        setSettings(normalizeSettings(settings));
      })
      .catch((error) => {
        console.error("Failed to load theme settings:", error);
      });
  }, [repository]);

  // Resolve theme based on current theme and OS preference
  useEffect(() => {
    const computeResolved = (): "light" | "dark" => {
      if (theme === "system") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      }
      return theme;
    };

    const updateResolved = () => {
      setResolved(computeResolved());
    };

    updateResolved();

    // Subscribe to OS theme changes only when theme is "system"
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        updateResolved();
      };

      mediaQuery.addEventListener("change", handleChange);

      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }
  }, [theme]);

  // Apply dark class to document element based on resolved theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setTheme = (newTheme: Theme) => {
    const next = normalizeSettings({ ...settings, theme: newTheme });
    setSettings(next);
    repository.write(next).catch((error) => {
      console.error("Failed to save theme setting:", error);
    });
  };

  const setPanelWidths = (widths: { projectRailWidth: number; assistantWidth: number }) => {
    const next = normalizeSettings({ ...settings, ...widths });
    setSettings(next);
    repository.write(next).catch((error) => {
      console.error("Failed to save panel settings:", error);
    });
  };

  return (
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      resolved,
      projectRailWidth: settings.projectRailWidth ?? PROJECT_RAIL_WIDTH.default,
      assistantWidth: settings.assistantWidth ?? ASSISTANT_WIDTH.default,
      setPanelWidths,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
