import { useEffect } from "react";
import { X } from "lucide-react";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="w-full max-w-sm rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)]"
        style={{ minWidth: "320px" }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
          <button
            aria-label={t("settings.close")}
            className="rounded-lg p-2 text-app-muted transition-colors hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-app-muted">
              {t("settings.theme")}
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-app-bg p-1">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => handleThemeSelect(option.value)}
                  className={`
                    rounded-md px-3 py-2 text-sm font-medium
                    transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-app-primary
                    ${
                      theme === option.value
                        ? "bg-app-primary text-app-on-primary shadow-sm"
                        : "text-app-muted hover:bg-app-panel-strong hover:text-app-ink"
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
