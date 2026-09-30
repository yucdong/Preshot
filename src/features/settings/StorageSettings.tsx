import { useTranslation } from "react-i18next";
import { useStorage } from "./StorageContext";

const button = "rounded-md border border-app-border px-3 py-2 text-sm hover:bg-app-primary-soft disabled:opacity-50";

export function StorageSettings() {
  const storage = useStorage();
  const { t } = useTranslation();
  if (!storage) return null;
  const { info, busy, error } = storage;
  return <section className="space-y-3" aria-labelledby="storage-title" aria-busy={busy}>
    <h3 id="storage-title" className="text-sm font-semibold">{t("storage.title")}</h3>
    <p className="text-xs text-app-muted">{t("storage.retention")}</p>
    {info && <dl className="space-y-3 text-xs">
      {([
        ["configuration", info.configurationDirectory],
        ["application", info.applicationDirectory],
        ["library", info.libraryDirectory],
      ] as const).map(([kind, value]) => <div key={kind}>
        <dt className="font-medium">{t(`storage.${kind}`)}</dt>
        <dd className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 break-all select-text">{value}</span>
          <button type="button" className={button} disabled={busy || (kind === "library" && (info.needsSetup || !!info.problem))}
            aria-label={t("storage.openNamed", { name: t(`storage.${kind}`) })}
            onClick={() => void storage.reveal(kind)}>{t("storage.open")}</button>
        </dd>
      </div>)}
    </dl>}
    {info?.problem && <p role="alert" className="text-sm text-red-600">{t("storage.unavailable")} <span className="break-words">{info.problem}</span></p>}
    {error && <p role="alert" className="text-sm text-red-600">{t("storage.failed")} <span className="break-words">{error}</span></p>}
    {busy && <p role="status" className="text-sm">{t("storage.working")}</p>}
    {storage.moved && <p role="status" className="text-sm">{t("storage.moved")}</p>}
    {info?.pendingMove && <>
      <p className="text-sm">{t("storage.pending")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void storage.move(null)}>{t("storage.resume")}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void storage.cancelMove()}>{t("storage.cancelMove")}</button>
      </div>
    </>}
    <div className="flex gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => void storage.refresh()}>{t("storage.retry")}</button>
      {!info && <button type="button" className={button} disabled={busy}
        onClick={() => void storage.reveal("configuration")}>{t("storage.openConfig")}</button>}
    </div>
  </section>;
}
