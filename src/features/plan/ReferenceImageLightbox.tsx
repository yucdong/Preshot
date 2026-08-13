import { useEffect, useRef } from "react";
import { RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReferenceImageLightboxProps {
  src: string;
  alt: string;
  onClose(): void;
  onReset?(): void;
}

export function ReferenceImageLightbox({ src, alt, onClose, onReset }: ReferenceImageLightboxProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
    >
      <div
        aria-label={alt}
        aria-modal="true"
        className="relative flex max-h-[90vh] flex-col"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <img alt={alt} className="min-h-0 max-h-[85vh] max-w-[90vw] object-contain" src={src} />
        <button
          aria-label={t("lightbox.close")}
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-black/65 text-white transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" data-icon="close" />
        </button>
        {onReset ? (
          <button
            aria-label="恢复尺寸"
            className="mt-2 inline-flex h-9 items-center gap-2 self-end rounded border border-white/25 bg-white/10 px-3 text-xs text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => {
              onReset();
              onClose();
            }}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            恢复尺寸
          </button>
        ) : null}
      </div>
    </div>
  );
}
