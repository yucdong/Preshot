import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogPortalHost } from "../../shared/ui/DialogPortalContext";

interface CloseProjectDialogProps {
  projectName: string;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onClose(saveChanges: boolean): void;
}

export function CloseProjectDialog({ projectName, busy, error, onCancel, onClose }: CloseProjectDialogProps) {
  const host = useDialogPortalHost();
  const dialogRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const origin = document.activeElement;
    saveRef.current?.focus();
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) {
        window.setTimeout(() => origin.focus({ preventScroll: true }), 0);
      }
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      data-preshot-surface="true"
      onClick={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        aria-busy={busy} tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onCancel();
          }
          if (event.key === "Tab") {
            const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            const first = buttons[0];
            const last = buttons.at(-1);
            if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
              event.preventDefault();
              (event.shiftKey ? last : first)?.focus();
            }
          }
        }}>
        <h2 id={titleId} className="text-lg font-semibold">关闭“{projectName}”前是否保存？</h2>
        <p id={descriptionId} className="mt-3 text-sm text-app-muted">不保存将放弃尚未保存的修改，已自动保存的内容会保留。</p>
        {error ? <p role="alert" className="mt-3 text-sm text-app-danger">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel}
            className="rounded-lg border border-app-border px-3 py-2 text-sm disabled:opacity-50">取消</button>
          <button type="button" disabled={busy} onClick={() => onClose(false)}
            className="rounded-lg border border-app-border px-3 py-2 text-sm text-app-danger disabled:opacity-50">不保存并关闭</button>
          <button ref={saveRef} type="button" disabled={busy} onClick={() => onClose(true)}
            className="rounded-lg bg-app-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "正在关闭…" : "保存并关闭"}</button>
        </div>
      </div>
    </div>, host,
  );
}
