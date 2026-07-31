import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReferenceImage } from "../../domain/plan/models";

const squareButton =
  "group relative block aspect-square w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

interface SortableImageTileProps {
  image: ReferenceImage;
  index: number;
  src: string | undefined;
  onOpen(file: string): void;
  onRemove(imageId: string): void;
}

export function SortableImageTile({ image, index, src, onOpen, onRemove }: SortableImageTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div className="relative" ref={setNodeRef} style={style}>
      <button
        aria-label={`Open reference image ${index + 1}`}
        className={squareButton}
        onClick={() => onOpen(image.file)}
        type="button"
        {...attributes}
        {...listeners}
      >
        {src ? (
          <img alt={`Reference image ${index + 1}`} className="h-full w-full object-cover" src={src} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">Loading…</span>
        )}
      </button>
      <button
        aria-label={`Remove reference image ${index + 1}`}
        className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
        onClick={() => onRemove(image.id)}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
