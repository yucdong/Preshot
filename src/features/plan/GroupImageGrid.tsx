import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { imageGroupDroppableId } from "./canvas/imageDropTarget";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import { SortableImageTile } from "./SortableImageTile";

// Minimal shape that both v1 ReferenceGroup and v2+ ReferenceComponent satisfy
interface GroupLike {
  id: string;
  images: Array<{ id: string; file: string; caption?: string }>;
}

interface GroupImageGridProps {
  group: GroupLike;
  imageSrc(file: string): string | undefined;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
  droppableId?: string;
  fragmentId?: string;
  enableReorder?: boolean;
  showCaptions?: boolean;
  onSetCaption?: (imageId: string, caption: string) => void;
  slots: ReferenceFlowSlot[];
  scale: number;
  hiddenImageId?: string;
  placeholderImage?: { id: string; file: string; caption?: string };
  placeholderSlot?: ReferenceFlowSlot;
  placeholderIndex?: number;
}

export function GroupImageGrid({ 
  group, 
  imageSrc, 
  onAddImage, 
  onRemoveImage, 
  onOpenImage, 
  droppableId, 
  fragmentId,
  enableReorder = false, 
  showCaptions = false, 
  onSetCaption,
  slots,
  scale,
  hiddenImageId,
  placeholderImage,
  placeholderSlot,
  placeholderIndex,
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
              <button
                aria-label={t("reference.addImage")}
                className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600 dark:border-stone-700 dark:text-stone-500 dark:hover:border-amber-400 dark:hover:text-amber-400"
                onClick={() => onAddImage(group.id)}
                type="button"
              >
                +
              </button>
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
            src={imageSrc(image.file)}
            draggable={enableReorder}
            showCaptions={showCaptions}
            onSetCaption={onSetCaption}
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
          src={imageSrc(placeholderImage.file)}
          draggable={enableReorder}
          isPlaceholder
          showCaptions={showCaptions}
          onSetCaption={onSetCaption}
          slot={normalizedPlaceholderSlot}
          scale={scale}
        />
      ) : null}
    </>
  );

  if (enableReorder) {
    return (
      <div
        className="relative"
        data-component-id={group.id}
        data-image-group-droppable-id={actualDroppableId}
        ref={setNodeRef}
        style={{ height: `${containerHeight}px` }}
      >
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
      {gridContent}
    </div>
  );
}
