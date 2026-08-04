import { useTranslation } from "react-i18next";

export function AgentPanel() {
  const { t } = useTranslation();
  
  return (
    <aside
      aria-label={t("agent.title")}
      className="flex min-h-0 min-w-0 flex-col border-l border-stone-200 bg-stone-100 dark:border-white/10 dark:bg-stone-950"
    >
      <header className="flex h-12 items-center gap-2 border-b border-stone-200 px-4 dark:border-white/10">
        <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">{t("agent.title")}</h2>
        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-600 dark:bg-white/10 dark:text-stone-400">
          {t("agent.preview")}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-stone-600 dark:text-stone-400">
          {t("agent.comingSoon")}
        </p>
      </div>

      <form
        className="border-t border-stone-200 p-3 dark:border-white/10"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="sr-only" htmlFor="assistant-input">
          {t("agent.inputLabel")}
        </label>
        <textarea
          className="w-full resize-none rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/5 dark:text-stone-200 dark:placeholder:text-stone-600"
          disabled
          id="assistant-input"
          placeholder={t("agent.inputPlaceholder")}
          rows={2}
        />
        <div className="mt-2 flex justify-end">
          <button
            className="rounded-full bg-stone-200 px-4 py-1.5 text-xs font-medium text-stone-600 disabled:cursor-not-allowed dark:bg-white/10 dark:text-stone-400"
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
