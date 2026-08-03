import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";

const squareButton =
  "group relative block aspect-square w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

interface ReferenceImageLike {
  id: string;
  file: string;
  caption?: string;
}

interface SortableImageTileProps {
  image: ReferenceImageLike;
  index: number;
  src: string | undefined;
  onOpen(file: string): void;
  onRemove(imageId: string): void;
  draggable?: boolean;
  showCaptions?: boolean;
  onSetCaption?: (imageId: string, caption: string) => void;
}

export function SortableImageTile({ image, index, src, onOpen, onRemove, draggable = true, showCaptions = false, onSetCaption }: SortableImageTileProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });

  // When draggable is false, don't apply transform or drag styles
  const style = draggable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
      }
    : {};

  return (
    <div className="relative" ref={setNodeRef} style={style}>
      <button
        aria-label={t("reference.openImage", { index: index + 1 })}
        className={squareButton}
        onClick={() => onOpen(image.file)}
        type="button"
        {...(draggable ? { ...attributes, ...listeners } : {})}
      >
        {src ? (
          <img alt={t("reference.imageAlt")} className="h-full w-full object-cover" src={src} />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">{t("reference.loading")}</span>
        )}
      </button>
      <button
        aria-label={t("reference.removeImage", { index: index + 1 })}
        className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
        onClick={() => onRemove(image.id)}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        ×
      </button>
      {showCaptions && onSetCaption && (
        <textarea
          aria-label={t("reference.captionAria", { index: index + 1 })}
          className="mt-1 w-full resize-none rounded border border-stone-300 px-2 py-1 text-xs focus:border-amber-500 focus:outline-none"
          onChange={(e) => onSetCaption(image.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder={t("content.captionPlaceholder")}
          rows={2}
          value={image.caption ?? ""}
        />
      )}
    </div>
  );
}
