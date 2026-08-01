import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type { ReferenceGroup } from "../../domain/plan/models";
import { groupDroppableId } from "./dropTarget";
import { SortableImageTile } from "./SortableImageTile";

interface GroupImageGridProps {
  group: ReferenceGroup;
  imageSrc(file: string): string | undefined;
  onAddImage(groupId: string): void;
  onRemoveImage(groupId: string, imageId: string): void;
  onOpenImage(file: string): void;
}

export function GroupImageGrid({ group, imageSrc, onAddImage, onRemoveImage, onOpenImage }: GroupImageGridProps) {
  const { setNodeRef } = useDroppable({ id: groupDroppableId(group.id) });

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
        aria-label="Add reference image"
        className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-stone-300 text-3xl text-stone-400 hover:border-amber-500 hover:text-amber-600"
        onClick={() => onAddImage(group.id)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
