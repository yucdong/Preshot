import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ScreenCaptureReviewImage } from "../../domain/plan/ports";
import { useDialogPortalHost } from "../../shared/ui/DialogPortalContext";
import { ui, useUiLanguage } from "../../shared/i18n/ui";

export type CaptureReviewRequest = { image: ScreenCaptureReviewImage; finish(value: "keep" | "retry" | "cancel"): void };

export function CaptureReviewDialog({ request }: { request: CaptureReviewRequest }) {
  useUiLanguage();
  const host = useDialogPortalHost();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('[data-retry]')?.focus();
    return () => { if (before instanceof HTMLElement && before.isConnected && !before.closest("[inert]")) before.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 p-4"
    onPointerDown={event => { if (event.target === event.currentTarget) request.finish("cancel"); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={ui("检查截图")}
      className="w-full max-w-md rounded-lg border border-app-border bg-app-panel-strong p-5 text-app-ink shadow-xl"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); request.finish("cancel"); }
        if (event.key === "Tab") {
          const buttons = dialog.current!.querySelectorAll<HTMLButtonElement>("button");
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
          else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
        }
      }}>
      <h2 className="mb-3 text-lg font-semibold">{ui("检查截图")}</h2>
      <p className="mb-3 text-sm">{ui("截图可能为空白或黑屏。请检查预览，可以重新截图，或保留确实需要的画面。")}</p>
      <img src={request.image.previewUrl} alt={ui("截图预览")} className="mb-4 max-h-52 w-full rounded border border-app-border bg-white object-contain" />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="rounded border border-app-border px-3 py-2" onClick={() => request.finish("cancel")}>{ui("取消")}</button>
        <button type="button" className="rounded border border-app-border px-3 py-2" onClick={() => request.finish("keep")}>{ui("保留截图")}</button>
        <button type="button" data-retry className="rounded bg-app-primary px-3 py-2 text-app-on-primary" onClick={() => request.finish("retry")}>{ui("重新截图")}</button>
      </div>
    </div>
  </div>, host);
}
