import { useState } from "react";
import { useTranslation } from "react-i18next";
import { clampImageHeight, DEFAULT_IMAGE_HEIGHT, type ReferenceComponent } from "../../../domain/plan/canvas/models";
import { COMPONENT_INSET, type ReferenceFlowSlot } from "../../../domain/plan/canvas/referenceLayout";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";
import { useNaturalHeight } from "./useNaturalHeight";

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
  slots: ReferenceFlowSlot[];
  scale: number;
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
  slots,
  scale,
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();
  const [showDescription, setShowDescription] = useState(false);
  const isContinuation = fragmentKind === "continuation";
  const isEditableFragment = !isContinuation;
  const sectionGap = `${COMPONENT_INSET * scale}px`;
  const descriptionRef = useNaturalHeight({
    id: component.id,
    scale,
    onHeight: (id, heightPoints) => {
      if (isEditableFragment) {
        onMeasureDescription?.(id, heightPoints);
      }
    },
  });

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
    <div className="flex flex-col" data-fragment-index={fragmentIndex} style={{ gap: sectionGap }}>
      {isEditableFragment ? (
        <>
          <div className="flex items-center gap-4">
            <input
              aria-label={t("reference.groupTitleAria")}
              className="flex-1 border-b border-stone-300 px-2 py-1 text-lg font-semibold focus:border-amber-500 focus:outline-none dark:border-stone-700 dark:bg-transparent dark:text-stone-100"
              onChange={(e) => onSetTitle(component.id, e.target.value)}
              type="text"
              value={component.title}
            />
            {onSetImageHeight ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone-600 dark:text-stone-300">{t("reference.imageHeight")}</span>
                <button
                  aria-label={t("reference.decreaseImageHeight")}
                  className="rounded border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700"
                  onClick={handleDecreaseHeight}
                  type="button"
                >
                  −
                </button>
                <button
                  aria-label={t("reference.increaseImageHeight")}
                  className="rounded border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700"
                  onClick={handleIncreaseHeight}
                  type="button"
                >
                  +
                </button>
              </div>
            ) : null}
          </div>

          {onToggleCaptions ? (
            <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
              <input
                checked={component.showCaptions}
                className="rounded"
                onChange={() => onToggleCaptions(component.id)}
                type="checkbox"
              />
              {t("reference.captions")}
            </label>
          ) : null}

          {(component.description.trim() || showDescription) ? (
            <RichTextEditor
              ariaLabel={t("reference.descriptionAria")}
              compact
              html={component.description}
              onChange={(html) => onSetDescription(component.id, html)}
              placeholder={t("reference.descriptionPlaceholder")}
              rootRef={descriptionRef}
            />
          ) : (
            <button
              className="w-fit text-sm text-amber-600 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 dark:text-amber-400 dark:hover:text-amber-300"
              onClick={() => setShowDescription(true)}
              type="button"
            >
              {t("reference.addDescription")}
            </button>
          )}
        </>
      ) : (
        <div className="text-lg font-semibold dark:text-stone-100">{t("reference.continuedTitle", { title: component.title })}</div>
      )}

      <div data-testid="reference-component-body">
        <GroupImageGrid
          enableReorder={enableReorder}
          group={component}
          imageSrc={imageSrc}
          onAddImage={onAddImages ?? onAddImage}
          onOpenImage={onOpenImage}
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
