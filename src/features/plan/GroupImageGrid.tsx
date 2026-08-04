import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import type { Rect } from "../../domain/plan/canvas/geometry";
import { imageGroupDroppableId } from "./canvas/imageDropTarget";
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
  slots: Rect[];
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

  // Bottom of content is the maximum of all slot bottoms (handles differing aspect-ratio heights)
  const contentBottom = slots.length ? Math.max(...slots.map((s) => s.y + s.height)) : 0;
  
  // Calculate container height based on max slot bottom edge
  const containerHeight = slots.length > 0
    ? contentBottom * scale
    : 0;

  // Position for the add button (after the last slot or at the beginning)
  // Add button dimensions in points, scaled uniformly
  const addButtonSlot = slots.length > 0 
    ? { 
        x: 0, 
        y: contentBottom + 12,
        width: 160,
        height: 120,
      }
    : { x: 0, y: 0, width: 160, height: 120 };

  const gridContent = (
    <>
      {group.images.map((image, index) => {
        const slot = slots[index];
        if (!slot) return null;
        
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
      <div
        style={{
          position: "absolute",
          left: `${addButtonSlot.x * scale}px`,
          top: `${addButtonSlot.y * scale}px`,
          width: `${addButtonSlot.width * scale}px`,
          height: `${addButtonSlot.height * scale}px`,
        }}
      >
        <button
          aria-label={t("reference.addImage")}
          className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600"
          onClick={() => onAddImage(group.id)}
          type="button"
        >
          +
        </button>
      </div>
    </>
  );

  if (enableReorder) {
    return (
      <div
        className="mt-4 relative"
        ref={setNodeRef}
        style={{ height: `${containerHeight + addButtonSlot.height + 24}px` }}
      >
        <SortableContext items={group.images.map((image) => image.id)} strategy={rectSortingStrategy}>
          {gridContent}
        </SortableContext>
      </div>
    );
  }

  return (
    <div
      className="mt-4 relative"
      style={{ height: `${containerHeight + addButtonSlot.height + 24}px` }}
    >
      {gridContent}
    </div>
  );
}
