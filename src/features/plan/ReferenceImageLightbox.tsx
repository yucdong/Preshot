import { ui, useUiLanguage } from "../../shared/i18n/ui";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useDialogPortalHost } from "../../shared/ui/DialogPortalContext";
import { DialogPortalContext } from "../../shared/ui/DialogPortalContext";
import { useImageClipboardPort } from "./ImageClipboardContext";
import { imageClipboardFilename, unavailableImageClipboard } from "../../domain/clipboard/imageClipboard";
import { ImageClipboardScope } from "./blocknote/clipboard/ImageClipboardScope";

interface ReferenceImageLightboxProps {
  src: string;
  alt: string;
  copyScope?: "project" | "draft";
  onClose(): void;
}

function isTopmostDialog(dialog: HTMLElement | null): boolean {
  if (!dialog || dialog.closest("[inert], [aria-hidden='true']")) return false;
  return Array.from(document.querySelectorAll(
    '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  )).filter((element) => !element.closest("[inert], [aria-hidden='true']")).at(-1) === dialog;
}

export function ReferenceImageLightbox({
  src,
  alt,
  copyScope = "project",
  onClose,
}: ReferenceImageLightboxProps) {
  useUiLanguage();
  const portalHost = useDialogPortalHost();
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const clipboardPortalHost = useCallback(() => dialogRef.current ?? portalHost, [portalHost]);
  const imageClipboard = useImageClipboardPort();
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    const keepFocus = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!isTopmostDialog(dialog) || dialog?.contains(event.target as Node)) return;
      const target = dialog?.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
      );
      (target ?? dialog)?.focus();
    };
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("focusin", keepFocus);
      returnFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isTopmostDialog(dialogRef.current)) return;
      if (event.key === "Escape") {
        if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).sort((left, right) => {
        if (left === right) return 0;
        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1;
      });
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 sm:p-6"
      data-reference-image-lightbox=""
      data-preshot-surface="true"
      data-testid="reference-image-backdrop"
      onClick={onClose}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#17191d] text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <DialogPortalContext.Provider value={clipboardPortalHost}>
        <ImageClipboardScope port={imageClipboard ?? unavailableImageClipboard}
          className="contents"
          defaultSelection={{ kind: "gallery", groupId: "viewer", imageId: "current" }}
          resolveImage={() => ({ dataUrl: src, name: imageClipboardFilename(alt) })}>
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold" id={titleId}>
              {alt}
            </h2>
            <p className="text-xs text-white/65" id={descriptionId}>
              {copyScope === "draft"
                ? ui("查看当前素材草稿中的参考图片副本。")
                : ui("查看项目中的参考图片副本。")}
            </p>
          </div>
          <button
            aria-label={t("lightbox.close")}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" data-icon="close" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <img
            alt={alt}
            className="min-h-0 max-h-[72vh] max-w-full cursor-default object-contain focus-visible:outline-2 focus-visible:outline-sky-400"
            data-clipboard-gallery="viewer"
            data-image-clipboard-id="current"
            tabIndex={0}
            onClick={(event) => event.currentTarget.focus()}
            src={src}
          />
        </div>
        </ImageClipboardScope>
        </DialogPortalContext.Provider>
      </div>
    </div>,
    portalHost,
  );
}
