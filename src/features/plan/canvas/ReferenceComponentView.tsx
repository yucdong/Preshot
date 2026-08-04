import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Rect } from "../../../domain/plan/canvas/geometry";
import { clampImageHeight, DEFAULT_IMAGE_HEIGHT, type ReferenceComponent } from "../../../domain/plan/canvas/models";
import { RichTextEditor } from "../RichTextEditor";
import { GroupImageGrid } from "../GroupImageGrid";

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
  slots: Rect[];
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
  slots,
  scale,
}: ReferenceComponentViewProps) {
  const { t } = useTranslation();
  const [showDescription, setShowDescription] = useState(false);

  const currentImageHeight = component.imageHeight ?? DEFAULT_IMAGE_HEIGHT;

  const handleIncreaseHeight = () => {
    if (onSetImageHeight) {
      onSetImageHeight(component.id, clampImageHeight(currentImageHeight + 20));
    }
  };

  const handleDecreaseHeight = () => {
    if (onSetImageHeight) {
      onSetImageHeight(component.id, clampImageHeight(currentImageHeight - 20));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Title input and image-height stepper */}
      <div className="mb-2 flex items-center gap-4">
        <input
          aria-label={t("reference.groupTitleAria")}
          className="flex-1 border-b border-stone-300 px-2 py-1 text-lg font-semibold focus:border-amber-500 focus:outline-none dark:border-stone-700 dark:bg-transparent dark:text-stone-100"
          onChange={(e) => onSetTitle(component.id, e.target.value)}
          type="text"
          value={component.title}
        />
        {onSetImageHeight && (
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
        )}
      </div>

      {/* Caption toggle */}
      <div className="mb-2 flex items-center gap-4">
        {onToggleCaptions && (
          <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
            <input
              checked={component.showCaptions}
              className="rounded"
              onChange={() => onToggleCaptions(component.id)}
              type="checkbox"
            />
            {t("reference.captions")}
          </label>
        )}
      </div>

      {/* Optional description editor */}
      {(component.description.trim() || showDescription) && (
        <div className="mb-2">
          <RichTextEditor
            ariaLabel={t("reference.descriptionAria")}
            compact
            html={component.description}
            onChange={(html) => onSetDescription(component.id, html)}
            placeholder={t("reference.descriptionPlaceholder")}
          />
        </div>
      )}

      {/* Add description button */}
      {!component.description.trim() && !showDescription && (
        <div className="mb-2">
          <button
            className="text-sm text-amber-600 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 dark:text-amber-400 dark:hover:text-amber-300"
            onClick={() => setShowDescription(true)}
            type="button"
          >
            {t("reference.addDescription")}
          </button>
        </div>
      )}

      {/* Image grid (reuse GroupImageGrid) */}
      <div className="flex-1 overflow-auto">
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
