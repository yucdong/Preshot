import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReferenceImageLightboxProps {
  src: string;
  alt: string;
  onClose(): void;
}

export function ReferenceImageLightbox({ src, alt, onClose }: ReferenceImageLightboxProps) {
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
      data-preshot-surface="true"
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
      </div>
    </div>
  );
}
