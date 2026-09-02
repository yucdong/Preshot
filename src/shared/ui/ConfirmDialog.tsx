import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  confirmDisabled = false,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    confirmButtonRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Tab" && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
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
    }
  };

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      onCancel();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      data-preshot-surface="true"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)]"
        style={{ minWidth: "320px" }}
      >
        <h2 className="mb-5 text-lg font-semibold">{title}</h2>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-app-border bg-app-panel px-4 py-2 text-sm font-medium text-app-muted transition-colors hover:border-app-primary hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-primary"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className="rounded-lg bg-app-danger px-4 py-2 text-sm font-semibold text-app-on-danger transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
