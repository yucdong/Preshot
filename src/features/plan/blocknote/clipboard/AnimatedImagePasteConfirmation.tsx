import { ui, useUiLanguage } from "../../../../shared/i18n/ui";
import { useCallback, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function AnimatedImagePasteConfirmation({ host, onDecision }: {
  host: HTMLElement;
  onDecision(confirmed: boolean): void;
}) {
  useUiLanguage();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    const origin = originRef.current;
    originRef.current = null;
    if (origin?.isConnected && !origin.closest("[inert]")) origin.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    originRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus({ preventScroll: true });
    return restoreFocus;
  }, [restoreFocus]);
  const decide = (confirmed: boolean) => {
    // Restore before the coordinator can select the newly pasted image.
    // A delayed dialog cleanup must never refocus the old source afterward.
    restoreFocus();
    onDecision(confirmed);
  };
  return createPortal(<div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/55 p-6"
    onClick={(event) => { if (event.target === event.currentTarget) decide(false); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      className="w-full max-w-sm rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-lg"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          decide(false);
        }
        if (event.key === "Tab") {
          const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}>
      <h2 id={titleId} className="text-base font-semibold">{ui("将动态图转换为第一帧静态图片？")}</h2>
      <p id={descriptionId} className="mt-3 text-sm text-app-muted">{ui("图片组只支持静态图片。原始动态图保持不变；继续会粘贴其第一帧的新副本。")}</p>
      <div className="mt-5 flex justify-end gap-3">
        <button ref={cancelRef} type="button" className="min-h-10 rounded border border-app-border px-3 text-sm focus-visible:outline-2 focus-visible:outline-app-accent"
          onClick={() => decide(false)}>{ui("取消")}</button>
        <button type="button" className="min-h-10 rounded bg-app-accent px-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-app-accent"
          onClick={() => decide(true)}>{ui("转换为静态图片并粘贴")}</button>
      </div>
    </div>
  </div>, host);
}
