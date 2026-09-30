import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStorage } from "./StorageContext";

const button = "rounded-md border border-app-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary hover:bg-app-primary-soft disabled:opacity-50";
const primary = `${button.replace("hover:bg-app-primary-soft", "hover:opacity-90")} bg-app-primary text-app-on-primary`;

// This comparison only avoids an unnecessary prompt; native code validates the
// canonical directories and requires confirmation before an actual switch.
function comparable(path: string) {
  return path.trim().replaceAll("/", "\\").replace(/^\\\\\?\\/, "").replace(/\\+$/, "").toLowerCase();
}

export function FirstLaunchSetup() {
  const storage = useStorage();
  const { t } = useTranslation();
  const existing = storage?.info?.existingWorkingDirectory;
  const [path, setPath] = useState(storage?.info?.configurationDirectory ?? "");
  const [choosing, setChoosing] = useState(!existing);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const pickingRef = useRef(false);
  useEffect(() => {
    if (confirming) back.current?.focus();
    else if (choosing) input.current?.focus();
    else keep.current?.focus();
  }, [choosing, confirming]);
  if (!storage?.info) return null;
  const busy = storage.busy || picking;
  const changed = !!existing && comparable(path) !== comparable(existing);
  const submit = () => {
    if (busy || !path.trim()) return;
    if (changed) setConfirming(true);
    else void storage.configure(path.trim());
  };
  return <section className="space-y-4" aria-busy={busy}>
    <div hidden={confirming} className="space-y-4">
      <p className="text-sm leading-6 text-app-muted">{t("storage.setupIntro")}</p>
      {existing && <div className="space-y-2 rounded-lg border border-app-border bg-app-bg p-3">
        <p className="text-sm font-medium">{t("storage.detected")}</p>
        <p className="break-all select-text text-sm">{existing}</p>
        <p className="text-xs leading-5 text-app-muted">{t("storage.keepHint")}</p>
      </div>}
      {!choosing ? <div className="flex flex-wrap gap-2">
        <button ref={keep} type="button" className={primary} disabled={busy}
          onClick={() => void storage.configure(existing!)}>{t("storage.keep")}</button>
        <button type="button" className={button} disabled={busy}
          onClick={() => setChoosing(true)}>{t("storage.change")}</button>
      </div> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); submit(); }}>
        <label className="block text-sm font-medium" htmlFor="working-directory">{t("storage.destination")}</label>
        <div className="flex flex-wrap gap-2">
          <input ref={input} id="working-directory" aria-describedby="working-directory-hint"
            className="min-w-0 flex-1 rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm"
            value={path} disabled={busy} onChange={event => setPath(event.target.value)} />
          <button type="button" className={button} disabled={busy} onClick={async () => {
            if (pickingRef.current) return;
            pickingRef.current = true; setPicking(true);
            try {
              const chosen = await storage.pickDirectory(path);
              if (chosen) setPath(chosen);
            } finally { pickingRef.current = false; setPicking(false); }
          }}>{t("storage.browse")}</button>
        </div>
        <p id="working-directory-hint" className="text-xs leading-5 text-app-muted">{t("storage.setupHint")}</p>
        {existing && <p className="text-sm leading-6 text-app-muted">{t("storage.switchWarning")}</p>}
        <div className="flex flex-wrap gap-2">
          {existing && <button type="button" className={button} disabled={busy}
            onClick={() => { setPath(existing); setChoosing(false); }}>{t("common.cancel")}</button>}
          <button type="submit" className={primary} disabled={busy || !path.trim()}>{t("storage.create")}</button>
        </div>
      </form>}
    </div>
    {confirming && <div role="alertdialog" aria-modal="true" aria-labelledby="switch-directory-title"
      aria-describedby="switch-directory-warning" className="space-y-4" onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) setConfirming(false);
        }
        if (event.key === "Tab") {
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const first = items[0]; const last = items.at(-1);
          if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault(); (event.shiftKey ? last : first)?.focus();
          }
        }
      }}>
      <h2 id="switch-directory-title" className="text-base font-semibold">{t("storage.confirmTitle")}</h2>
      <dl className="space-y-3 text-sm">
        <div><dt className="text-app-muted">{t("storage.previousDirectory")}</dt><dd className="mt-1 break-all select-text">{existing}</dd></div>
        <div><dt className="text-app-muted">{t("storage.nextDirectory")}</dt><dd className="mt-1 break-all select-text">{path.trim()}</dd></div>
      </dl>
      <p id="switch-directory-warning" className="text-sm leading-6">{t("storage.switchWarning")}</p>
      <div className="flex flex-wrap gap-2">
        <button ref={back} type="button" className={button} disabled={busy}
          onClick={() => setConfirming(false)}>{t("storage.back")}</button>
        <button type="button" className={primary} disabled={busy}
          onClick={() => void storage.configure(path.trim(), true)}>{t("storage.confirmSwitch")}</button>
      </div>
    </div>}
    {storage.error && <p role="alert" className="break-words text-sm text-app-danger">{t("storage.failed")} {storage.error}</p>}
    {storage.busy && <p role="status" className="text-sm">{t("storage.setupWorking")}</p>}
    <p className="border-t border-app-border pt-3 text-xs leading-5 text-app-muted">{t("storage.retention")}</p>
  </section>;
}
