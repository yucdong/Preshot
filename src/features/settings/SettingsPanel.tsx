import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../app/theme/ThemeContext";
import type { Theme } from "../../domain/settings/models";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };
  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: "light", label: t("settings.themeLight") },
    { value: "dark", label: t("settings.themeDark") },
    { value: "system", label: t("settings.themeSystem") },
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        aria-label={t("settings.title")}
        aria-modal="true"
        className="max-h-[min(760px,calc(100vh-32px))] w-full max-w-md overflow-y-auto rounded-xl border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)] focus:outline-none"
        role="dialog"
        tabIndex={-1}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t("settings.title")}</h2>
          <button
            aria-label={t("settings.close")}
            className="rounded-lg p-2 text-app-muted transition-colors hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="appearance-settings-heading">
            <h3
              className="mb-2 text-sm font-semibold text-app-ink"
              id="appearance-settings-heading"
            >
              {t("settings.appearance")}
            </h3>
            <label className="mb-2 block text-sm font-medium text-app-muted">
              {t("settings.theme")}
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-app-bg p-1">
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  aria-pressed={theme === option.value}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional ${
                    theme === option.value
                      ? "bg-app-primary text-app-on-primary shadow-sm"
                      : "text-app-muted hover:bg-app-panel-strong hover:text-app-ink"
                  }`}
                  onClick={() => setTheme(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
