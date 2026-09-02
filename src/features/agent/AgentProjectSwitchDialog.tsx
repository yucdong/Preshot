import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentProjectSwitchChoice,
  AgentProjectSwitchView,
} from "../../domain/agent";

interface AgentProjectSwitchDialogProps {
  readonly state: AgentProjectSwitchView;
  readonly onChoose: (choice: AgentProjectSwitchChoice) => void;
  readonly onCancelWait: () => void;
}

export function AgentProjectSwitchDialog({
  state,
  onChoose,
}: AgentProjectSwitchDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = state.status === "choosing" || state.status === "stopping";
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button:not(:disabled)",
    );
    first?.focus();
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
    };
  }, [open]);
  if (state.status === "none" || state.status === "waiting") return null;
  const stopping = state.status === "stopping";
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!stopping) onChoose("cancel");
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"),
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
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px]"
      data-preshot-surface="true"
    >
      <div
        ref={dialogRef}
        aria-label={t("agent.switchDialogTitle", {
          project: state.targetProjectName,
        })}
        aria-modal="true"
        className="w-full max-w-md rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-[var(--app-shadow)]"
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <h2 className="text-lg font-semibold">
          {t("agent.switchDialogTitle", {
            project: state.targetProjectName,
          })}
        </h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          {stopping
            ? t("agent.switchStopping")
            : t("agent.switchChoosing")}
        </p>
        <div className="mt-5 flex justify-end gap-3">
          {stopping ? null : (
            <>
              <button
                className="rounded-lg border border-app-border px-4 py-2 text-sm font-medium text-app-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                onClick={() => onChoose("cancel")}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                className="rounded-lg border border-app-border bg-app-panel px-4 py-2 text-sm font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                onClick={() => onChoose("wait")}
                type="button"
              >
                {t("agent.waitAndSwitch")}
              </button>
              <button
                className="rounded-lg bg-app-danger px-4 py-2 text-sm font-semibold text-app-on-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
                onClick={() => onChoose("stop")}
                type="button"
              >
                {t("agent.stopAndSwitch")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
