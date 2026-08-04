import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../app/theme/ThemeProvider";
import type { Theme } from "../../domain/settings/models";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleThemeSelect = (selectedTheme: Theme) => {
    setTheme(selectedTheme);
  };

  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="rounded-lg bg-white p-6 shadow-xl dark:bg-stone-900"
        style={{ minWidth: "320px" }}
      >
        <h2 className="mb-4 text-lg font-semibold text-stone-800 dark:text-stone-100">
          {t("settings.title")}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
              {t("settings.theme")}
            </label>
            <div className="flex gap-2">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => handleThemeSelect(option.value)}
                  className={`
                    flex-1 rounded-md px-3 py-2 text-sm font-medium
                    transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300
                    ${
                      theme === option.value
                        ? "bg-amber-500 text-white dark:bg-amber-600"
                        : "bg-stone-200 text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600"
                    }
                  `}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
