import { useTranslation } from "react-i18next";

export function ScreenshotIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      data-testid="screenshot-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M4 3h10v14H4zM7 3v14M4 7h10M17 13l4-4M18 18l3 3M16.5 16.5l4.5-4.5"
        stroke="currentColor"
        strokeDasharray="2 2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="16.5" cy="16.5" fill="currentColor" r="1.7" />
      <circle cx="21" cy="21" fill="currentColor" r="1.7" />
    </svg>
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
          className="flex h-1/2 w-full items-center justify-center border-b border-stone-300/80 text-stone-600 hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 dark:border-stone-600/80 dark:text-stone-300 dark:hover:bg-stone-700 dark:focus-visible:bg-stone-700"
          disabled={unavailable}
          onClick={onImport}
          title={t("reference.importImageDescription")}
          type="button"
        >
          <span aria-hidden="true" style={{ fontSize: `${16 * scale}px` }}>+</span>
        </button>
        <button
          aria-label={t("reference.captureImage")}
          className="flex h-1/2 w-full items-center justify-center text-stone-600 hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-700 dark:focus-visible:bg-stone-700"
          disabled={captureUnavailable}
          onClick={onCapture}
          title={t("reference.captureImageDescription")}
          type="button"
        >
          <ScreenshotIcon size={14 * scale} />
        </button>
      </div>
    );
  }

  return (
    <div className="order-first flex items-center" data-testid="image-action-buttons" style={{ gap: `${6 * scale}px` }}>
      <button
        aria-label={t("reference.addImage")}
        className="flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 dark:border-stone-600 dark:text-stone-300"
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
        className="flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 dark:border-stone-600 dark:text-stone-300"
        disabled={captureUnavailable}
        onClick={onCapture}
        style={{ height: `${20 * scale}px`, width: `${24 * scale}px` }}
        title={t("reference.captureImageDescription")}
        type="button"
      >
        <ScreenshotIcon size={14 * scale} />
      </button>
    </div>
  );
}
