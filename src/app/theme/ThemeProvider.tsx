import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { SettingsRepository } from "../../domain/settings/ports";
import type { Theme } from "../../domain/settings/models";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
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
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  // Load theme from repository on mount
  useEffect(() => {
    repository
      .read()
      .then((settings) => {
        setThemeState(settings.theme);
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
    setThemeState(newTheme);
    repository.write({ theme: newTheme }).catch((error) => {
      console.error("Failed to save theme setting:", error);
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
