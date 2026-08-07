import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import {
  createAnimateLayoutChanges,
  createMotionStyleTransition,
  SORTABLE_LAYOUT_TRANSITION,
} from "./canvas/dragMotion";
import { usePrefersReducedMotion } from "../../shared/hooks/usePrefersReducedMotion";

const tileButton =
  "group relative block h-full w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-white/10 dark:bg-stone-800";

interface ReferenceImageLike {
  id: string;
  file: string;
}

interface SortableImageTileProps {
  image: ReferenceImageLike;
  index: number;
  src: string | undefined;
  onOpen(file: string): void;
  onRemove(imageId: string): void;
  onSelect(imageId: string, toggle: boolean): void;
  componentId: string;
  selected?: boolean;
  draggable?: boolean;
  slot: ReferenceFlowSlot;
  scale: number;
  isPlaceholder?: boolean;
}

export function SortableImageTile({
  image,
  index,
  src,
  onOpen,
  onRemove,
  onSelect,
  componentId,
  selected = false,
  draggable = true,
  slot,
  scale,
  isPlaceholder = false,
}: SortableImageTileProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    data: { type: "image", componentId },
    animateLayoutChanges: createAnimateLayoutChanges(prefersReducedMotion),
    transition: prefersReducedMotion ? undefined : SORTABLE_LAYOUT_TRANSITION,
  });
  const placeholderVisible = isPlaceholder || isDragging;
  const style = {
    position: "absolute" as const,
    left: `${slot.x * scale}px`,
    top: `${slot.y * scale}px`,
    width: `${slot.width * scale}px`,
    height: `${slot.height * scale}px`,
    transform:
      !draggable || prefersReducedMotion || placeholderVisible || !transform
        ? undefined
        : CSS.Transform.toString(transform),
    transition: placeholderVisible
      ? undefined
      : createMotionStyleTransition(prefersReducedMotion, draggable ? transition : undefined),
  };

  return (
    <div
      ref={setNodeRef}
      className="group"
      style={style}
      data-image-id={image.id}
      data-selected={selected ? "true" : "false"}
      data-testid={placeholderVisible ? `image-placeholder-${image.id}` : `image-tile-${image.id}`}
    >
      <button
        {...(draggable ? { ...attributes, ...listeners } : {})}
        aria-label={t("reference.selectImage", { index: index + 1 })}
        aria-pressed={selected}
        className={`${tileButton} ${
          placeholderVisible
            ? "border-2 border-dashed border-amber-500 bg-transparent"
            : selected
              ? "ring-2 ring-amber-500 ring-offset-2 dark:ring-amber-300 dark:ring-offset-stone-900"
              : ""
        }`}
        onClick={(event) => onSelect(image.id, event.ctrlKey)}
        onDoubleClick={() => onOpen(image.file)}
        type="button"
      >
        <div
          className="relative h-full overflow-hidden"
          data-testid="image-region"
          style={{ opacity: placeholderVisible ? 0 : 1 }}
        >
          {src ? (
            <img
              alt={t("reference.imageAlt")}
              className="absolute object-contain"
              draggable={false}
              src={src}
              style={{ width: "100%", height: "100%", left: 0, top: 0 }}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">
              {t("reference.loading")}
            </span>
          )}
        </div>
      </button>
      {!placeholderVisible ? (
        <button
          aria-label={t("reference.removeImage", { index: index + 1 })}
          className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white"
          onClick={() => onRemove(image.id)}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
