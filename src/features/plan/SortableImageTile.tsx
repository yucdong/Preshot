import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
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
  aspectRatio?: number;
  displayHeight?: number;
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
  onSetCaption?: (imageId: string, caption: string) => void;
  slot: ReferenceFlowSlot;
  scale: number;
  isPlaceholder?: boolean;
  onSetDisplayHeight?: (imageId: string, displayHeight: number | undefined) => void;
  onPreviewDisplayHeight?: (imageId: string, displayHeight: number) => void;
  onCancelResize?: () => void;
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
  onSetCaption,
  slot,
  scale,
  isPlaceholder = false,
  onSetDisplayHeight,
  onPreviewDisplayHeight,
  onCancelResize,
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
  const captionVisible = Boolean(image.caption?.trim());
  const captionHeight = slot.captionHeight * scale;
  const captionEditorHeight = captionVisible ? captionHeight : 24 * scale;
  const placeholderVisible = isPlaceholder || isDragging;
  const [resizeSession, setResizeSession] = useState<{
    element: HTMLElement;
    pointerId: number;
  } | null>(null);
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    y: number;
    edge: "top" | "right" | "bottom" | "left";
    displayHeight: number;
    aspectRatio: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<number | null>(null);

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

  const onPointerDownResize = (
    edge: "top" | "right" | "bottom" | "left",
  ) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSetDisplayHeight) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setResizeSession({ element: event.currentTarget, pointerId: event.pointerId });
    const ratio =
      Number.isFinite(image.aspectRatio) && (image.aspectRatio ?? 0) > 0
        ? image.aspectRatio!
        : 1;
    const start = {
      edge,
      x: event.clientX,
      y: event.clientY,
      displayHeight: image.displayHeight ?? slot.imageHeight,
      aspectRatio: ratio,
    };
    setResizeStart(start);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const previewHeight = (event: React.PointerEvent<HTMLDivElement>): number | null => {
    const start = resizeStart;
    if (!start) {
      return null;
    }
    const deltaPoints =
      start.edge === "top"
        ? -(event.clientY - start.y) / scale
        : start.edge === "bottom"
          ? (event.clientY - start.y) / scale
          : start.edge === "left"
            ? -(event.clientX - start.x) / scale / start.aspectRatio
            : (event.clientX - start.x) / scale / start.aspectRatio;
    return Math.max(32, start.displayHeight + deltaPoints);
  };

  const onPointerMoveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = previewHeight(event);
    if (next === null) {
      return;
    }
    setResizePreview(next);
    onPreviewDisplayHeight?.(image.id, next);
  };

  const finishResize = (
    event: React.PointerEvent<HTMLDivElement>,
    options: { commit: boolean; releaseCapture: boolean },
  ) => {
    const session = resizeSession;
    if (!session) {
      return;
    }
    const next = resizePreview;
    setResizeSession(null);
    setResizeStart(null);
    setResizePreview(null);
    if (options.releaseCapture && session.element.hasPointerCapture(event.pointerId)) {
      session.element.releasePointerCapture?.(event.pointerId);
    }
    if (options.commit && next !== null) {
      onSetDisplayHeight?.(image.id, next);
    } else if (!options.commit) {
      onCancelResize?.();
    }
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
        style={{ height: `${imageHeight}px` }}
        onClick={(event) => onSelect(image.id, event.ctrlKey)}
        onDoubleClick={() => onOpen(image.file)}
        type="button"
      >
        <div className="relative h-full overflow-hidden" data-testid="image-region" style={{ height: `${imageHeight}px`, opacity: placeholderVisible ? 0 : 1 }}>
          {src ? (
            <img
              alt={t("reference.imageAlt")}
              className="absolute object-contain"
              draggable={false}
              src={src}
              style={{
                width: "100%",
                height: "100%",
                left: 0,
                top: 0,
              }}
            />
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
      {!placeholderVisible && onSetDisplayHeight ? (
        <>
          <div
            aria-label={t("reference.resizeImageTop")}
            className="absolute left-0 top-0 h-2 w-full cursor-ns-resize bg-stone-300/80 opacity-0 hover:opacity-100 focus-visible:opacity-100 dark:bg-stone-600/80"
            data-image-resize-handle="top"
            onLostPointerCapture={(event) =>
              finishResize(event, { commit: false, releaseCapture: false })
            }
            onPointerCancel={(event) =>
              finishResize(event, { commit: false, releaseCapture: true })
            }
            onPointerDown={onPointerDownResize("top")}
            onPointerMove={onPointerMoveResize}
            onPointerUp={(event) =>
              finishResize(event, { commit: true, releaseCapture: true })
            }
            role="separator"
            tabIndex={0}
          />
          <div
            aria-label={t("reference.resizeImageRight")}
            className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-stone-300/80 opacity-0 hover:opacity-100 focus-visible:opacity-100 dark:bg-stone-600/80"
            data-image-resize-handle="right"
            onLostPointerCapture={(event) =>
              finishResize(event, { commit: false, releaseCapture: false })
            }
            onPointerCancel={(event) =>
              finishResize(event, { commit: false, releaseCapture: true })
            }
            onPointerDown={onPointerDownResize("right")}
            onPointerMove={onPointerMoveResize}
            onPointerUp={(event) =>
              finishResize(event, { commit: true, releaseCapture: true })
            }
            role="separator"
            tabIndex={0}
          />
          <div
            aria-label={t("reference.resizeImageBottom")}
            className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize bg-stone-300/80 opacity-0 hover:opacity-100 focus-visible:opacity-100 dark:bg-stone-600/80"
            data-image-resize-handle="bottom"
            onLostPointerCapture={(event) =>
              finishResize(event, { commit: false, releaseCapture: false })
            }
            onPointerCancel={(event) =>
              finishResize(event, { commit: false, releaseCapture: true })
            }
            onPointerDown={onPointerDownResize("bottom")}
            onPointerMove={onPointerMoveResize}
            onPointerUp={(event) =>
              finishResize(event, { commit: true, releaseCapture: true })
            }
            role="separator"
            tabIndex={0}
          />
          <div
            aria-label={t("reference.resizeImageLeft")}
            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-stone-300/80 opacity-0 hover:opacity-100 focus-visible:opacity-100 dark:bg-stone-600/80"
            data-image-resize-handle="left"
            onLostPointerCapture={(event) =>
              finishResize(event, { commit: false, releaseCapture: false })
            }
            onPointerCancel={(event) =>
              finishResize(event, { commit: false, releaseCapture: true })
            }
            onPointerDown={onPointerDownResize("left")}
            onPointerMove={onPointerMoveResize}
            onPointerUp={(event) =>
              finishResize(event, { commit: true, releaseCapture: true })
            }
            role="separator"
            tabIndex={0}
          />
          {image.displayHeight !== undefined ? (
            <button
              aria-label={t("reference.resetImageSize")}
              className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              onClick={() => onSetDisplayHeight(image.id, undefined)}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              ↺
            </button>
          ) : null}
        </>
      ) : null}
      {captionVisible && placeholderVisible ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 rounded border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-800"
          style={{ height: `${captionHeight}px`, opacity: 0 }}
        />
      ) : onSetCaption ? (
        <textarea
          aria-label={t("reference.captionAria", { index: index + 1 })}
          className={`absolute resize-none rounded border border-stone-300 bg-white px-2 py-1 focus:border-amber-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 ${
            captionVisible
              ? ""
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100"
          }`}
          style={{
            bottom: 0,
            left: 0,
            right: 0,
            fontSize: `${(slot.captionFontSize ?? 9) * scale}px`,
            height: `${captionEditorHeight}px`,
            lineHeight: `${(slot.captionLineHeight ?? 10.8) * scale}px`,
          }}
          onChange={(e) => onSetCaption(image.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder={t("content.captionPlaceholder")}
          value={image.caption ?? ""}
        />
      ) : captionVisible ? (
        <div
          className="absolute bottom-0 left-0 right-0 overflow-hidden rounded border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          style={{
            fontSize: `${(slot.captionFontSize ?? 9) * scale}px`,
            height: `${captionHeight}px`,
            lineHeight: `${(slot.captionLineHeight ?? 10.8) * scale}px`,
          }}
        >
          {image.caption}
        </div>
      ) : null}
    </div>
  );
}
