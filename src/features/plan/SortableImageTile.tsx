import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import { createAnimateLayoutChanges, createMotionStyleTransition, SORTABLE_LAYOUT_TRANSITION } from "./canvas/dragMotion";
import { usePrefersReducedMotion } from "../../shared/hooks/usePrefersReducedMotion";

const tileButton =
  "group relative block h-full w-full overflow-hidden rounded-xl border border-black/10 bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-white/10 dark:bg-stone-800";

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
  componentId: string;
  draggable?: boolean;
  showCaptions?: boolean;
  onSetCaption?: (imageId: string, caption: string) => void;
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
  componentId, 
  draggable = true, 
  showCaptions = false, 
  onSetCaption,
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
  const imageHeight = slot.imageHeight * scale;
  const captionHeight = showCaptions ? slot.captionHeight * scale : 0;
  const placeholderVisible = isPlaceholder || isDragging;

  // When draggable is false, don't apply transform or drag styles
  const style = draggable
    ? {
        position: "absolute" as const,
        left: `${slot.x * scale}px`,
        top: `${slot.y * scale}px`,
        width: `${slot.width * scale}px`,
        height: `${slot.height * scale}px`,
        transform:
          prefersReducedMotion || placeholderVisible || !transform
            ? undefined
            : CSS.Transform.toString(transform),
        transition: placeholderVisible
          ? undefined
          : createMotionStyleTransition(prefersReducedMotion, transition),
      }
    : {
        position: "absolute" as const,
        left: `${slot.x * scale}px`,
        top: `${slot.y * scale}px`,
        width: `${slot.width * scale}px`,
        height: `${slot.height * scale}px`,
        transition: createMotionStyleTransition(prefersReducedMotion),
      };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-image-id={image.id}
      data-testid={placeholderVisible ? `image-placeholder-${image.id}` : undefined}
    >
      <button
        aria-label={t("reference.openImage", { index: index + 1 })}
        className={`${tileButton} ${placeholderVisible ? "border-2 border-dashed border-amber-500 bg-transparent" : ""}`}
        style={{ height: `${imageHeight}px` }}
        onClick={() => onOpen(image.file)}
        type="button"
        {...(draggable ? { ...attributes, ...listeners } : {})}
      >
        <div data-testid="image-region" style={{ height: `${imageHeight}px`, opacity: placeholderVisible ? 0 : 1 }}>
          {src ? (
            <img alt={t("reference.imageAlt")} className="h-full w-full object-contain" draggable={false} src={src} />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xs text-stone-400">{t("reference.loading")}</span>
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
      {showCaptions && (placeholderVisible ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 rounded border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-800"
          style={{
            height: `${captionHeight}px`,
            opacity: 0,
          }}
        />
      ) : onSetCaption ? (
        <textarea
          aria-label={t("reference.captionAria", { index: index + 1 })}
          className="absolute resize-none rounded border border-stone-300 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
          style={{
            bottom: 0,
            left: 0,
            right: 0,
            height: `${captionHeight}px`,
          }}
          onChange={(e) => onSetCaption(image.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder={t("content.captionPlaceholder")}
          value={image.caption ?? ""}
        />
      ) : null)}
    </div>
  );
}
