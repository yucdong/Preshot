import { useCallback, useState, type MutableRefObject, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { clampImageHeight, DEFAULT_IMAGE_HEIGHT, type ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  COMPONENT_INSET,
  REFERENCE_CONTINUATION_TITLE_HEIGHT,
  REFERENCE_CONTROL_ROW_HEIGHT,
  REFERENCE_DESCRIPTION_GAP,
  REFERENCE_HEADER_GAP,
  REFERENCE_TITLE_ROW_HEIGHT,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";
import { useNaturalHeight } from "./useNaturalHeight";
import { usePlanContentMeasurement } from "./usePlanContentMeasurement";

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
  onSetTitle: (id: string, title: string) => void;
  onSetDescription: (id: string, description: string) => void;
  onAddImage: (id: string) => void;
  onRemoveImage: (componentId: string, imageId: string) => void;
  onOpenImage: (file: string) => void;
  onToggleCaptions?: (id: string) => void;
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
}

export function ReferenceComponentView({
  component,
  imageSrc,
  onSetTitle,
  onSetDescription,
  onAddImage,
  onRemoveImage,
  onOpenImage,
  onToggleCaptions,
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
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();
  const [showDescription, setShowDescription] = useState(false);
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
            <input
              aria-label={t("reference.groupTitleAria")}
              className="min-w-0 flex-1 border-b border-stone-300 font-semibold focus:border-amber-500 focus:outline-none dark:border-stone-700 dark:bg-transparent dark:text-stone-100"
              onChange={(e) => onSetTitle(component.id, e.target.value)}
              style={{
                fontSize: `${18 * scale}px`,
                height: `${REFERENCE_TITLE_ROW_HEIGHT * scale}px`,
                lineHeight: `${22 * scale}px`,
                paddingLeft: `${8 * scale}px`,
                paddingRight: `${8 * scale}px`,
              }}
              type="text"
              value={component.name}
            />
            {onSetImageHeight ? (
              <div className="flex items-center" style={{ gap: `${8 * scale}px` }}>
                <span
                  className="text-stone-600 dark:text-stone-300"
                  style={{ fontSize: `${14 * scale}px`, lineHeight: `${18 * scale}px` }}
                >
                  {t("reference.imageHeight")}
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
            {onToggleCaptions ? (
              <label
                className="flex items-center text-stone-600 dark:text-stone-300"
                style={{
                  fontSize: `${14 * scale}px`,
                  gap: `${8 * scale}px`,
                  lineHeight: `${REFERENCE_CONTROL_ROW_HEIGHT * scale}px`,
                }}
              >
                <input
                  checked={component.showCaptions}
                  className="rounded"
                  onChange={() => onToggleCaptions(component.id)}
                  style={{ height: `${14 * scale}px`, width: `${14 * scale}px` }}
                  type="checkbox"
                />
                {t("reference.captions")}
              </label>
            ) : <span />}

            {!component.description.trim() && !showDescription ? (
              <button
                className="w-fit text-amber-600 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 dark:text-amber-400 dark:hover:text-amber-300"
                onClick={() => setShowDescription(true)}
                style={{
                  fontSize: `${14 * scale}px`,
                  lineHeight: `${REFERENCE_CONTROL_ROW_HEIGHT * scale}px`,
                }}
                type="button"
              >
                {t("reference.addDescription")}
              </button>
            ) : null}
          </div>

          {component.description.trim() || showDescription ? (
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
      ) : (
        <div
          className="font-semibold dark:text-stone-100"
          data-testid="reference-continuation-title"
          style={{
            fontSize: `${18 * scale}px`,
            height: `${REFERENCE_CONTINUATION_TITLE_HEIGHT * scale}px`,
            lineHeight: `${REFERENCE_CONTINUATION_TITLE_HEIGHT * scale}px`,
            marginBottom: `${REFERENCE_HEADER_GAP * scale}px`,
          }}
        >
          {t("reference.continuedTitle", { title: component.name })}
        </div>
      )}

      <div data-testid="reference-component-body">
        <GroupImageGrid
          enableReorder={enableReorder}
          fragmentId={fragmentId}
          group={component}
          hiddenImageId={hiddenImageId}
          imageSrc={imageSrc}
          onAddImage={onAddImages ?? onAddImage}
          onOpenImage={onOpenImage}
          placeholderImage={placeholderImage}
          placeholderIndex={placeholderIndex}
          placeholderSlot={placeholderSlot}
          onRemoveImage={onRemoveImage}
          showCaptions={component.showCaptions}
          onSetCaption={onSetImageCaption ? (imageId, caption) => onSetImageCaption(component.id, imageId, caption) : undefined}
          slots={slots}
          scale={scale}
        />
      </div>
    </div>
  );
}
