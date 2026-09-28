import {
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { SettingsRepository } from "../../domain/settings/ports";
import {
  DEFAULT_SETTINGS,
  PROJECT_RAIL_WIDTH,
  normalizeSettings,
  type AppSettings,
  type Theme,
  type Language,
} from "../../domain/settings/models";
import { ThemeContext } from "./ThemeContext";
import { LanguageContext } from "../language/LanguageContext";
import i18n from "../../shared/i18n/config";

interface ThemeProviderProps {
  repository: SettingsRepository;
  children: ReactNode;
}

export function ThemeProvider({ repository, children }: ThemeProviderProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [saveError, setSaveError] = useState(false);
  const current = useRef(settings);
  const changed = useRef<Partial<AppSettings>>({});
  const writes = useRef(Promise.resolve());
  const theme = settings.theme;

  // Load theme from repository on mount
  useEffect(() => {
    let active = true;
    repository
      .read()
      .then((settings) => {
        if (!active) return;
        current.current = normalizeSettings({ ...settings, ...changed.current });
        setSettings(current.current);
      })
      .catch((error) => {
        console.error("Failed to load theme settings:", error);
      });
    return () => { active = false; };
  }, [repository]);

  useEffect(() => {
    const language = settings.language ?? "zh";
    void i18n.changeLanguage(language);
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  }, [settings.language]);

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

  const updateSettings = (patch: Partial<AppSettings>, failureMessage: string) => {
    changed.current = { ...changed.current, ...patch };
    current.current = normalizeSettings({ ...current.current, ...patch });
    setSettings(current.current);
    setSaveError(false);
    // Serialize patches so a slower theme/width write cannot overwrite a newer language.
    writes.current = writes.current.then(async () => {
      const latest = await repository.read();
      await repository.write(normalizeSettings({ ...latest, ...patch }));
    })
      .catch((error) => {
        setSaveError(true);
        console.error(failureMessage, error);
      });
  };

  const setTheme = (newTheme: Theme) => {
    updateSettings({ theme: newTheme }, "Failed to save theme setting:");
  };

  const setPanelWidths = (widths: { projectRailWidth: number }) => {
    updateSettings(widths, "Failed to save panel settings:");
  };
  const setLanguage = (language: Language) => updateSettings({ language }, "Failed to save language setting:");

  return (
    <LanguageContext.Provider value={{ language: settings.language ?? "zh", setLanguage, saveError }}>
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      resolved,
      projectRailWidth: settings.projectRailWidth ?? PROJECT_RAIL_WIDTH.default,
      setPanelWidths,
    }}>
      {children}
    </ThemeContext.Provider>
    </LanguageContext.Provider>
  );
}
