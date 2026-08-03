import { useTranslation } from "react-i18next";

export function AgentPanel() {
  const { t } = useTranslation();
  
  return (
    <aside
      aria-label={t("agent.title")}
      className="flex min-h-0 min-w-0 flex-col border-l border-white/10 bg-stone-950"
    >
      <header className="flex h-12 items-center gap-2 border-b border-white/10 px-4">
        <h2 className="text-sm font-semibold text-stone-200">{t("agent.title")}</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-400">
          {t("agent.preview")}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-stone-500">
          {t("agent.comingSoon")}
        </p>
      </div>

      <form
        className="border-t border-white/10 p-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="sr-only" htmlFor="assistant-input">
          {t("agent.inputLabel")}
        </label>
        <textarea
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none disabled:cursor-not-allowed"
          disabled
          id="assistant-input"
          placeholder={t("agent.inputPlaceholder")}
          rows={2}
        />
        <div className="mt-2 flex justify-end">
          <button
            className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-stone-400 disabled:cursor-not-allowed"
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
