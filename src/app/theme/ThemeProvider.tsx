import {
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
import { ThemeContext } from "./ThemeContext";

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

  const persistSettings = (next: AppSettings, failureMessage: string) => {
    repository.read()
      .then((latest) => repository.write(normalizeSettings({
        ...latest,
        ...next,
        agentModel: latest.agentModel ?? next.agentModel,
      })))
      .catch((error) => {
        console.error(failureMessage, error);
      });
  };

  const setTheme = (newTheme: Theme) => {
    const next = normalizeSettings({ ...settings, theme: newTheme });
    setSettings(next);
    persistSettings(next, "Failed to save theme setting:");
  };

  const setPanelWidths = (widths: { projectRailWidth: number; assistantWidth: number }) => {
    const next = normalizeSettings({ ...settings, ...widths });
    setSettings(next);
    persistSettings(next, "Failed to save panel settings:");
  };

  const setAssistantOpen = (assistantOpen: boolean) => {
    const next = normalizeSettings({ ...settings, assistantOpen });
    setSettings(next);
    persistSettings(next, "Failed to save assistant visibility:");
  };

  return (
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      resolved,
      projectRailWidth: settings.projectRailWidth ?? PROJECT_RAIL_WIDTH.default,
      assistantWidth: settings.assistantWidth ?? ASSISTANT_WIDTH.default,
      assistantOpen: settings.assistantOpen ?? false,
      setAssistantOpen,
      setPanelWidths,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
