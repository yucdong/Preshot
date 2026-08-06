import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface ReferenceImageLightboxProps {
  src: string;
  alt: string;
  onClose(): void;
}

export function ReferenceImageLightbox({ src, alt, onClose }: ReferenceImageLightboxProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
    >
      <div
        aria-label={alt}
        aria-modal="true"
        className="relative"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <img alt={alt} className="max-h-[85vh] max-w-[90vw] object-contain" src={src} />
        <button
          aria-label={t("lightbox.close")}
          className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}
