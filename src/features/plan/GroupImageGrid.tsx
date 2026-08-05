import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { imageGroupDroppableId } from "./canvas/imageDropTarget";
import { COMPONENT_INSET, type ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
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
  enableReorder?: boolean;
  showCaptions?: boolean;
  onSetCaption?: (imageId: string, caption: string) => void;
  slots: ReferenceFlowSlot[];
  scale: number;
}

export function GroupImageGrid({ 
  group, 
  imageSrc, 
  onAddImage, 
  onRemoveImage, 
  onOpenImage, 
  droppableId, 
  enableReorder = false, 
  showCaptions = false, 
  onSetCaption,
  slots,
  scale,
}: GroupImageGridProps) {
  const { t } = useTranslation();
  const actualDroppableId = enableReorder ? imageGroupDroppableId(group.id) : (droppableId ?? `droppable-${group.id}`);
  const { setNodeRef } = useDroppable({ 
    id: actualDroppableId,
    data: enableReorder ? { type: "imagegroup" } : undefined
  });
  const imagesById = new Map(group.images.map((image) => [image.id, image]));

  // Bottom of content is the maximum of all slot bottoms (handles differing aspect-ratio heights)
  const contentBottom = slots.length ? Math.max(...slots.map((s) => s.y + s.height)) : 0;
  const containerHeight = contentBottom * scale;

  const gridContent = (
    <>
      {slots.map((slot, index) => {
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
    </>
  );

  if (enableReorder) {
    return (
      <div
        className="relative"
        ref={setNodeRef}
        style={{ height: `${containerHeight}px`, marginTop: `${COMPONENT_INSET * scale}px` }}
      >
        <SortableContext items={slots.filter((slot) => slot.kind === "image").map((slot) => slot.id)} strategy={rectSortingStrategy}>
          {gridContent}
        </SortableContext>
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{ height: `${containerHeight}px`, marginTop: `${COMPONENT_INSET * scale}px` }}
    >
      {gridContent}
    </div>
  );
}
