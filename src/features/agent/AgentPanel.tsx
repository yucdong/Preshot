import { useTranslation } from "react-i18next";

export function AgentPanel() {
  const { t } = useTranslation();
  
  return (
    <aside
      aria-label={t("agent.title")}
      className="flex min-h-0 min-w-0 flex-col bg-app-panel"
    >
      <header className="flex h-[52px] items-center gap-2 border-b border-app-border px-4">
        <h2 className="text-xs font-bold text-app-ink">{t("agent.title")}</h2>
        <span className="rounded-full bg-app-accent-soft px-2 py-0.5 text-[10px] font-semibold text-app-accent">
          {t("agent.preview")}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="rounded-lg border border-app-border bg-app-panel-strong p-3 text-xs leading-relaxed text-app-muted">
          {t("agent.comingSoon")}
        </p>
      </div>

      <form
        className="border-t border-app-border p-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="sr-only" htmlFor="assistant-input">
          {t("agent.inputLabel")}
        </label>
        <textarea
          className="w-full resize-none rounded-lg border border-app-border bg-app-panel-strong px-3 py-2 text-xs text-app-ink placeholder:text-app-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-not-allowed disabled:opacity-70"
          disabled
          id="assistant-input"
          placeholder={t("agent.inputPlaceholder")}
          rows={2}
        />
        <div className="mt-2 flex justify-end">
          <button
            className="rounded-lg bg-[#202329] px-4 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled
            type="submit"
          >
            {t("agent.send")}
          </button>
        </div>
      </form>
    </aside>
  );
}
