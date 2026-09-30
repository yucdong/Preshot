import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import type { StorageInfo, StorageRepository } from "../../domain/storage/ports";
import { StorageContext } from "../../features/settings/StorageContext";
import { StorageSettings } from "../../features/settings/StorageSettings";
import { FirstLaunchSetup } from "../../features/settings/FirstLaunchSetup";

function detail(error: unknown): string {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}

export function StorageProvider({ repository, children }: PropsWithChildren<{ repository: StorageRepository | null }>) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(!!repository);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [started, setStarted] = useState(!repository);
  const running = useRef(false);
  const usable = (value: StorageInfo) => !value.needsSetup && !value.pendingMove && !value.problem;
  useEffect(() => {
    if (!repository) return;
    let active = true;
    repository.status().then(value => {
      if (active) { setInfo(value); if (usable(value)) setStarted(true); }
    }).catch(reason => { if (active) setError(detail(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [repository]);
  if (!repository) return children;
  const run = async (operation: () => Promise<StorageInfo>, isMove = false) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null); setMoved(false);
    try {
      const value = await operation();
      setInfo(value);
      if (usable(value)) setStarted(true);
      setMoved(isMove && usable(value));
    } catch (reason) {
      setError(detail(reason));
      // A failed call may have committed a journal or the new root. Refresh
      // status without submitting another move or material save.
      try {
        const value = await repository.status();
        setInfo(value);
        // The locator may have committed before its command response was lost.
        // Enter only the verified result; never ask the user to submit it twice.
        if (usable(value)) setStarted(true);
      } catch { /* preserve original error */ }
    } finally { running.current = false; setBusy(false); }
  };
  const blocked = !started || !!info?.pendingMove || !!info?.problem;
  return <StorageContext.Provider value={{ info, busy, error, moved,
    refresh: () => run(() => repository.status()),
    configure: (path, confirmSwitch) => run(() => confirmSwitch === undefined
      ? repository.configure(path) : repository.configure(path, confirmSwitch)),
    move: path => run(() => repository.move(path), true),
    cancelMove: () => run(() => repository.cancelMove()),
    async reveal(kind) { try { await repository.reveal(kind); } catch (reason) { setError(detail(reason)); } },
    async pickDirectory(current) { try { return await repository.pickDirectory(current); } catch (reason) { setError(detail(reason)); return null; } },
  }}>
    {/* Never retire mounted project editors just because a storage operation failed. */}
    {started && <div inert={blocked || undefined} aria-hidden={blocked || undefined} className="contents">{children}</div>}
    {blocked && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-app-bg p-5 text-app-ink">
      <div className="max-h-full w-full max-w-xl overflow-auto rounded-xl border border-app-border bg-app-panel-strong p-6" role="region" aria-label={t("storage.setup")}>
        <h1 className="mb-5 text-xl font-semibold">{t("storage.setup")}</h1>
        {info?.needsSetup && !info.pendingMove && !info.problem
          ? <FirstLaunchSetup key={info.configurationDirectory} /> : <StorageSettings />}
      </div>
    </div>}
  </StorageContext.Provider>;
}
