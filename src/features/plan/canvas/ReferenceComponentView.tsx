import { useCallback, useState, type MutableRefObject, type Ref } from "react";
import { useTranslation } from "react-i18next";
import {
  clampImageHeight,
  DEFAULT_IMAGE_HEIGHT,
  type ReferenceComponent,
} from "../../../domain/plan/canvas/models";
import {
  COMPONENT_INSET,
  REFERENCE_CONTROL_ROW_HEIGHT,
  REFERENCE_DESCRIPTION_GAP,
  REFERENCE_HEADER_GAP,
  REFERENCE_TITLE_ROW_HEIGHT,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";
import type { ImageImportProgress } from "../imageImportProgress";
import { useNaturalHeight } from "./useNaturalHeight";
import { usePlanContentMeasurement } from "./usePlanContentMeasurement";

function ScreenshotIcon({ size }: { size: number }) {
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

function assignRef<T>(targetRef: Ref<T> | undefined, value: T): void {
  if (typeof targetRef === "function") {
    targetRef(value);
    return;
  }

  if (targetRef) {
    (targetRef as MutableRefObject<T>).current = value;
  }
}

interface ReferenceComponentViewProps {
  component: ReferenceComponent;
  imageSrc: (file: string) => string | undefined;
  onSetDescription: (id: string, description: string) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onSelectImage?: (imageId: string, toggle: boolean) => void;
  selectedImageIds?: ReadonlySet<string>;
  onToggleDescription?: (id: string) => void;
  onSetImageCaption?: (componentId: string, imageId: string, caption: string) => void;
  enableReorder?: boolean;
  onSetImageHeight?: (id: string, height: number) => void;
  onAddImages?: (id: string) => void;
  onMeasureDescription?: (id: string, heightPoints: number) => void;
  fragmentKind?: "whole" | "first" | "continuation";
  fragmentIndex?: number;
  fragmentId?: string;
  slots: ReferenceFlowSlot[];
  scale: number;
  hiddenImageId?: string;
  placeholderImage?: { id: string; file: string; caption?: string };
  placeholderSlot?: ReferenceFlowSlot;
  placeholderIndex?: number;
  importProgress?: ImageImportProgress;
  onCaptureImage?: (componentId: string) => void;
  onCancelCapture?: () => void;
  captureStatus?: "waiting" | "importing";
}

export function ReferenceComponentView({
  component,
  imageSrc,
  onSetDescription,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onSelectImage = () => undefined,
  selectedImageIds = new Set<string>(),
  onToggleDescription,
  onSetImageCaption,
  enableReorder = false,
  onSetImageHeight,
  onAddImages,
  onMeasureDescription,
  fragmentKind = "whole",
  fragmentIndex = 0,
  fragmentId,
  slots,
  scale,
  hiddenImageId,
  placeholderImage,
  placeholderSlot,
  placeholderIndex,
  importProgress,
  onCaptureImage,
  onCancelCapture,
  captureStatus,
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();
  const [descriptionHeightPoints, setDescriptionHeightPoints] = useState(0);
  const isContinuation = fragmentKind === "continuation";
  const isEditableFragment = !isContinuation;
  const naturalDescriptionRef = useNaturalHeight({
    id: component.id,
    scale,
    onHeight: (_id, heightPoints) => {
      setDescriptionHeightPoints((current) =>
        Math.abs(current - heightPoints) < 1 ? current : heightPoints,
      );
    },
  });
  const { rootRef: pagedDescriptionRef } = usePlanContentMeasurement({
    componentId: component.id,
    contentKey: component.description,
    scale,
    contentHeightPoints: descriptionHeightPoints,
    onMeasure: (id, measurement) => {
      if (isEditableFragment) {
        onMeasureDescription?.(id, measurement.heightPoints);
      }
    },
  });
  const setDescriptionRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(naturalDescriptionRef, node);
      assignRef(pagedDescriptionRef, node);
    },
    [naturalDescriptionRef, pagedDescriptionRef],
  );

  const currentImageHeight = component.imageHeight ?? DEFAULT_IMAGE_HEIGHT;

  const handleIncreaseHeight = () => {
    if (onSetImageHeight) {
      onSetImageHeight(component.id, clampImageHeight(currentImageHeight + 15));
    }
  };

  const handleDecreaseHeight = () => {
    if (onSetImageHeight) {
      onSetImageHeight(component.id, clampImageHeight(currentImageHeight - 15));
    }
  };

  return (
    <div
      data-fragment-index={fragmentIndex}
      data-testid="reference-component-content"
      style={{
        paddingBottom: `${COMPONENT_INSET * scale}px`,
        paddingTop: `${COMPONENT_INSET * scale}px`,
      }}
    >
      {isEditableFragment ? (
        <>
          <div
            className="flex items-center"
            data-testid="reference-title-row"
            style={{ gap: `${16 * scale}px`, height: `${REFERENCE_TITLE_ROW_HEIGHT * scale}px` }}
          >
            {onSetImageHeight ? (
              <div className="ml-auto flex items-center" style={{ gap: `${8 * scale}px` }}>
                <span
                  className="text-stone-600 dark:text-stone-300"
                  style={{ fontSize: `${14 * scale}px`, lineHeight: `${18 * scale}px` }}
                >
                  {t("reference.imageSize")}
                </span>
                <button
                  aria-label={t("reference.decreaseImageHeight")}
                  className="rounded border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700"
                  onClick={handleDecreaseHeight}
                  style={{
                    fontSize: `${14 * scale}px`,
                    height: `${20 * scale}px`,
                    lineHeight: `${18 * scale}px`,
                    width: `${24 * scale}px`,
                  }}
                  type="button"
                >
                  −
                </button>
                <button
                  aria-label={t("reference.increaseImageHeight")}
                  className="rounded border border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700"
                  onClick={handleIncreaseHeight}
                  style={{
                    fontSize: `${14 * scale}px`,
                    height: `${20 * scale}px`,
                    lineHeight: `${18 * scale}px`,
                    width: `${24 * scale}px`,
                  }}
                  type="button"
                >
                  +
                </button>
              </div>
            ) : null}
            <div className="order-first flex items-center" style={{ gap: `${6 * scale}px` }}>
              <button
                aria-label={t("reference.addImage")}
                className="flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 dark:border-stone-600 dark:text-stone-300"
                disabled={importProgress !== undefined || captureStatus !== undefined}
                onClick={() => (onAddImages ?? onAddImage)(component.id)}
                style={{ height: `${20 * scale}px`, width: `${24 * scale}px` }}
                title={t("reference.importImageDescription")}
                type="button"
              >
                +
              </button>
              <button
                aria-label={t("reference.captureImage")}
                className="flex items-center justify-center rounded border border-stone-300 text-stone-600 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 dark:border-stone-600 dark:text-stone-300"
                disabled={
                  onCaptureImage === undefined ||
                  importProgress !== undefined ||
                  captureStatus !== undefined
                }
                onClick={() => onCaptureImage?.(component.id)}
                style={{ height: `${20 * scale}px`, width: `${24 * scale}px` }}
                title={t("reference.captureImageDescription")}
                type="button"
              >
                <ScreenshotIcon size={14 * scale} />
              </button>
            </div>
          </div>

          <div
            className="flex items-center justify-between"
            data-testid="reference-control-row"
            style={{
              height: `${REFERENCE_CONTROL_ROW_HEIGHT * scale}px`,
              marginBottom: `${REFERENCE_HEADER_GAP * scale}px`,
              marginTop: `${REFERENCE_HEADER_GAP * scale}px`,
            }}
          >
            {onToggleDescription ? (
              <label
                className="flex items-center text-stone-600 dark:text-stone-300"
                style={{
                  fontSize: `${14 * scale}px`,
                  gap: `${8 * scale}px`,
                  lineHeight: `${REFERENCE_CONTROL_ROW_HEIGHT * scale}px`,
                }}
              >
                <input
                  checked={!component.showDescription}
                  className="rounded"
                  onChange={() => onToggleDescription(component.id)}
                  style={{ height: `${14 * scale}px`, width: `${14 * scale}px` }}
                  type="checkbox"
                />
                {t("reference.hideDescription")}
              </label>
            ) : <span />}

            {importProgress ? (
              <div className="flex min-w-0 items-center gap-2" role="status">
                <progress
                  aria-label={t("reference.importProgress")}
                  aria-valuemax={importProgress.total}
                  aria-valuemin={0}
                  aria-valuenow={importProgress.completed}
                  className="h-2 w-24 accent-amber-500"
                  max={importProgress.total}
                  value={importProgress.completed}
                />
                <span className="text-xs text-stone-600 dark:text-stone-300">
                  {t("reference.importProgressText", {
                    completed: importProgress.completed,
                    total: importProgress.total,
                    failed: importProgress.failed,
                  })}
                </span>
              </div>
            ) : captureStatus ? (
              <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300" role="status">
                <span>
                  {captureStatus === "waiting"
                    ? t("reference.captureWaiting")
                    : t("reference.captureImporting")}
                </span>
                {captureStatus === "waiting" ? (
                  <button
                    className="rounded border border-stone-300 px-2 dark:border-stone-600"
                    onClick={onCancelCapture}
                    type="button"
                  >
                    {t("reference.cancelCapture")}
                  </button>
                ) : null}
              </div>
            ) : null}

          </div>

          {component.showDescription ? (
            <div style={{ marginBottom: `${REFERENCE_DESCRIPTION_GAP * scale}px` }}>
              <RichTextEditor
                ariaLabel={t("reference.descriptionAria")}
                compact
                html={component.description}
                onChange={(html) => onSetDescription(component.id, html)}
                placeholder={t("reference.descriptionPlaceholder")}
                rootRef={setDescriptionRef}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <div data-testid="reference-component-body">
        <GroupImageGrid
          enableReorder={enableReorder}
          fragmentId={fragmentId}
          group={component}
          hiddenImageId={hiddenImageId}
          imageSrc={imageSrc}
          onOpenImage={onOpenImage}
          onSelectImage={onSelectImage}
          selectedImageIds={selectedImageIds}
          placeholderImage={placeholderImage}
          placeholderIndex={placeholderIndex}
          placeholderSlot={placeholderSlot}
          onRemoveImage={onRemoveImage}
          onSetCaption={
            isEditableFragment && onSetImageCaption
              ? (imageId, caption) => onSetImageCaption(component.id, imageId, caption)
              : undefined
          }
          slots={slots}
          scale={scale}
        />
      </div>
    </div>
  );
}
