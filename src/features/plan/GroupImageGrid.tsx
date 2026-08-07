import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { imageGroupDroppableId } from "./canvas/imageDropTarget";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import type { CropRect } from "../../domain/plan/canvas/models";
import { SortableImageTile } from "./SortableImageTile";
import type { ImageImportProgress } from "./imageImportProgress";

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

// Minimal shape that both v1 ReferenceGroup and v2+ ReferenceComponent satisfy
interface GroupLike {
  id: string;
  images: Array<{ id: string; file: string; caption?: string; aspectRatio?: number; crop?: CropRect }>;
}

interface GroupImageGridProps {
  group: GroupLike;
  imageSrc(file: string): string | undefined;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
  onSelectImage?: (imageId: string, toggle: boolean) => void;
  selectedImageIds?: ReadonlySet<string>;
  droppableId?: string;
  fragmentId?: string;
  enableReorder?: boolean;
  showCaptions?: boolean;
  onSetCaption?: (imageId: string, caption: string) => void;
  onSetCrop?: (imageId: string, crop: CropRect) => void;
  onPreviewCrop?: (imageId: string, crop: CropRect) => void;
  onCancelCropPreview?: (imageId: string) => void;
  onResetCrop?: (imageId: string) => void;
  slots: ReferenceFlowSlot[];
  scale: number;
  hiddenImageId?: string;
  placeholderImage?: { id: string; file: string; caption?: string };
  placeholderSlot?: ReferenceFlowSlot;
  placeholderIndex?: number;
  importProgress?: ImageImportProgress;
  onCaptureImage?: (groupId: string) => void;
  onCancelCapture?: () => void;
  captureStatus?: "waiting" | "importing";
}

export function GroupImageGrid({ 
  group, 
  imageSrc, 
  onAddImage, 
  onRemoveImage, 
  onOpenImage, 
  onSelectImage = () => undefined,
  selectedImageIds = new Set<string>(),
  droppableId, 
  fragmentId,
  enableReorder = false, 
  showCaptions = false, 
  onSetCaption,
  onSetCrop,
  onPreviewCrop,
  onCancelCropPreview,
  onResetCrop,
  slots,
  scale,
  hiddenImageId,
  placeholderImage,
  placeholderSlot,
  placeholderIndex,
  importProgress,
  onCaptureImage,
  onCancelCapture = () => undefined,
  captureStatus,
}: GroupImageGridProps) {
  const { t } = useTranslation();
  const actualDroppableId = enableReorder ? imageGroupDroppableId(group.id, fragmentId) : (droppableId ?? `droppable-${group.id}`);
  const { setNodeRef } = useDroppable({ 
    id: actualDroppableId,
    data: enableReorder ? { type: "imagegroup", componentId: group.id, fragmentId } : undefined
  });
  const imagesById = new Map(group.images.map((image) => [image.id, image]));
  const topOffset = slots.length ? Math.min(...slots.map((slot) => slot.y)) : 0;
  const normalizedSlots = slots.map((slot) => ({
    ...slot,
    y: slot.y - topOffset,
  }));

  // Bottom of content is the maximum of all slot bottoms (handles differing aspect-ratio heights)
  const contentBottom = [
    ...normalizedSlots.map((slot) => slot.y + slot.height),
    placeholderSlot ? placeholderSlot.y - topOffset + placeholderSlot.height : 0,
  ].reduce((max, value) => Math.max(max, value), 0);
  const containerHeight = Math.ceil(contentBottom * scale);
  const normalizedPlaceholderSlot =
    placeholderSlot == null
      ? undefined
      : {
          ...placeholderSlot,
          y: placeholderSlot.y - topOffset,
        };
  const visibleImageIds = normalizedSlots
    .filter((slot) => slot.kind === "image" && slot.id !== hiddenImageId)
    .map((slot) => slot.id);
  const sortableIds =
    normalizedPlaceholderSlot && placeholderImage && !visibleImageIds.includes(placeholderImage.id)
      ? [...visibleImageIds, placeholderImage.id]
      : visibleImageIds;

  const gridContent = (
    <>
      {normalizedSlots.map((slot, index) => {
        if (slot.kind === "add") {
          const iconSize = Math.max(12, Math.min(24, slot.height * scale * 0.45));
          return (
            <div
              key={`add:${slot.id}:${index}`}
              style={{
                position: "absolute",
                left: `${slot.x * scale}px`,
                top: `${slot.y * scale}px`,
                width: `${slot.width * scale}px`,
                height: `${slot.height * scale}px`,
              }}
            >
              <div className="grid h-full grid-cols-2 gap-2">
                <button
                  aria-label={t("reference.addImage")}
                  className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 dark:border-stone-700 dark:text-stone-500 dark:hover:border-amber-400 dark:hover:text-amber-400"
                  disabled={importProgress !== undefined || captureStatus !== undefined}
                  onClick={() => onAddImage(group.id)}
                  title={t("reference.importImageDescription")}
                  type="button"
                >
                  +
                </button>
                <button
                  aria-label={t("reference.captureImage")}
                  className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-sm font-medium text-stone-500 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 dark:border-stone-700 dark:text-stone-400 dark:hover:border-amber-400 dark:hover:text-amber-400"
                  disabled={
                    onCaptureImage === undefined ||
                    importProgress !== undefined ||
                    captureStatus !== undefined
                  }
                  onClick={() => onCaptureImage?.(group.id)}
                  title={t("reference.captureImageDescription")}
                  type="button"
                >
                  <ScreenshotIcon size={iconSize} />
                </button>
              </div>
            </div>
          );

        }

        if (slot.id === hiddenImageId) {
          return null;
        }

        const image = imagesById.get(slot.id);
        if (!image) {
          return null;
        }

        return (
          <SortableImageTile
            componentId={group.id}
            image={image}
            index={index}
            key={image.id}
            onOpen={onOpenImage}
            onRemove={(imageId) => onRemoveImage(group.id, imageId)}
            onSelect={onSelectImage}
            selected={selectedImageIds.has(image.id)}
            src={imageSrc(image.file)}
            draggable={enableReorder}
            showCaptions={showCaptions}
            onSetCaption={onSetCaption}
            onSetCrop={onSetCrop}
            onPreviewCrop={onPreviewCrop}
            onCancelCropPreview={onCancelCropPreview}
            onResetCrop={onResetCrop}
            slot={slot}
            scale={scale}
          />
        );

      })}
      {normalizedPlaceholderSlot && placeholderImage ? (
        <SortableImageTile
          componentId={group.id}
          image={placeholderImage}
          index={placeholderIndex ?? 0}
          key={`placeholder:${placeholderImage.id}:${fragmentId ?? group.id}`}
          onOpen={onOpenImage}
          onRemove={(imageId) => onRemoveImage(group.id, imageId)}
          onSelect={onSelectImage}
          selected={selectedImageIds.has(placeholderImage.id)}
          src={imageSrc(placeholderImage.file)}
          draggable={enableReorder}
          isPlaceholder
          showCaptions={showCaptions}
          onSetCaption={onSetCaption}
          onSetCrop={onSetCrop}
          onPreviewCrop={onPreviewCrop}
          onCancelCropPreview={onCancelCropPreview}
          onResetCrop={onResetCrop}
          slot={normalizedPlaceholderSlot}
          scale={scale}
        />
      ) : null}
    </>
  );

  const progressOverlay = importProgress ? (
    <div
      className="absolute left-2 right-2 top-2 z-30 rounded-lg bg-white/95 p-3 shadow-lg dark:bg-stone-900/95"
      role="status"
    >
      <div className="mb-1 text-xs font-medium text-stone-700 dark:text-stone-200">
        {t("reference.importProgressText", {
          completed: importProgress.completed,
          total: importProgress.total,
          failed: importProgress.failed,
        })}
      </div>
      <progress
        aria-label={t("reference.importProgress")}
        aria-valuemax={importProgress.total}
        aria-valuemin={0}
        aria-valuenow={importProgress.completed}
        className="h-2 w-full accent-amber-500"
        max={importProgress.total}
        value={importProgress.completed}
      />
    </div>
  ) : null;
  const captureOverlay = captureStatus ? (
    <div
      className="absolute left-2 right-2 top-2 z-30 flex items-center justify-between rounded-lg bg-white/95 p-3 shadow-lg dark:bg-stone-900/95"
      role="status"
    >
      <span className="text-xs font-medium text-stone-700 dark:text-stone-200">
        {captureStatus === "waiting"
          ? t("reference.captureWaiting")
          : t("reference.captureImporting")}
      </span>
      {captureStatus === "waiting" ? (
        <button
          className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
          onClick={onCancelCapture}
          type="button"
        >
          {t("reference.cancelCapture")}
        </button>
      ) : null}
    </div>
  ) : null;

  if (enableReorder) {
    return (
      <div
        className="relative"
        data-component-id={group.id}
        data-image-group-droppable-id={actualDroppableId}
        ref={setNodeRef}
        style={{ height: `${containerHeight}px` }}
      >
        {progressOverlay}
        {captureOverlay}
        <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
          {gridContent}
        </SortableContext>
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ height: `${containerHeight}px` }}
    >
      {progressOverlay}
      {captureOverlay}
      {gridContent}
    </div>
  );
}
