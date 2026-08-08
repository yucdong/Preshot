import { Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ScissorsIcon({ size }: { size: number }) {
  return (
    <Scissors
      aria-hidden="true"
      data-icon="scissors"
      data-testid="screenshot-icon"
      size={size}
      strokeWidth={1.8}
    />
  );
}

interface ImageActionButtonsProps {
  onImport?: () => void;
  onCapture?: () => void;
  disabled?: boolean;
  scale: number;
  variant: "toolbar" | "slot";
}

export function ImageActionButtons({
  onImport,
  onCapture,
  disabled = false,
  scale,
  variant,
}: ImageActionButtonsProps) {
  const { t } = useTranslation();
  const unavailable = disabled || onImport === undefined;
  const captureUnavailable = disabled || onCapture === undefined;

  if (variant === "slot") {
    return (
      <div
        className="pointer-events-none absolute inset-0 flex flex-col opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        data-testid="image-action-buttons"
      >
        <button
          aria-label={t("reference.addImage")}
          className="flex h-1/2 w-full items-center justify-center border-b border-paper-border text-paper-muted hover:bg-paper-primary-soft hover:text-paper-primary focus-visible:bg-paper-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary disabled:opacity-50"
          disabled={unavailable}
          onClick={onImport}
          title={t("reference.importImageDescription")}
          type="button"
        >
          <span aria-hidden="true" style={{ fontSize: `${16 * scale}px` }}>+</span>
        </button>
        <button
          aria-label={t("reference.captureImage")}
          className="flex h-1/2 w-full items-center justify-center text-paper-muted hover:bg-paper-primary-soft hover:text-paper-primary focus-visible:bg-paper-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary disabled:opacity-50"
          disabled={captureUnavailable}
          onClick={onCapture}
          title={t("reference.captureImageDescription")}
          type="button"
        >
          <ScissorsIcon size={14 * scale} />
        </button>
      </div>
    );
  }

  return (
    <div className="order-first flex items-center" data-testid="image-action-buttons" style={{ gap: `${6 * scale}px` }}>
      <button
        aria-label={t("reference.addImage")}
        className="flex items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-white/75 transition-[background-color,transform] duration-200 hover:bg-white/15 hover:text-white active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-50"
        disabled={unavailable}
        onClick={onImport}
        style={{ height: `${20 * scale}px`, width: `${24 * scale}px` }}
        title={t("reference.importImageDescription")}
        type="button"
      >
        +
      </button>
      <button
        aria-label={t("reference.captureImage")}
        className="flex items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-white/75 transition-[background-color,transform] duration-200 hover:bg-white/15 hover:text-white active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:opacity-50"
        disabled={captureUnavailable}
        onClick={onCapture}
        style={{ height: `${20 * scale}px`, width: `${24 * scale}px` }}
        title={t("reference.captureImageDescription")}
        type="button"
      >
        <ScissorsIcon size={14 * scale} />
      </button>
    </div>
  );
}
