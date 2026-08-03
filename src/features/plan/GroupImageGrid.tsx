import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { SortableImageTile } from "./SortableImageTile";

// Minimal shape that both v1 ReferenceGroup and v2 ReferenceComponent satisfy
interface GroupLike {
  id: string;
  columnsPerRow: number;
  images: Array<{ id: string; file: string }>;
}

interface GroupImageGridProps {
  group: GroupLike;
  imageSrc(file: string): string | undefined;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
  droppableId?: string;
}

export function GroupImageGrid({ group, imageSrc, onAddImage, onRemoveImage, onOpenImage, droppableId }: GroupImageGridProps) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({ id: droppableId ?? `droppable-${group.id}` });

  return (
    <div
      className="mt-4 grid justify-start gap-3"
      ref={setNodeRef}
      style={{ gridTemplateColumns: `repeat(${group.columnsPerRow}, minmax(0, 160px))` }}
    >
      <SortableContext items={group.images.map((image) => image.id)} strategy={rectSortingStrategy}>
        {group.images.map((image, index) => (
          <SortableImageTile
            image={image}
            index={index}
            key={image.id}
            onOpen={onOpenImage}
            onRemove={(imageId) => onRemoveImage(group.id, imageId)}
            src={imageSrc(image.file)}
          />
        ))}
      </SortableContext>
      <button
        aria-label={t("reference.addImage")}
        className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600"
        onClick={() => onAddImage(group.id)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
