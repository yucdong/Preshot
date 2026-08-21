import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import type { ReferenceFlowSlot } from "../../domain/plan/canvas/referenceLayout";
import {
  snapCardResize,
  type AlignmentGuides,
  type Rect,
  type ResizeEdge,
} from "../../domain/plan/canvas/geometry";
import {
  imageCropForView,
  imageViewCss,
  normalizeImageCrop,
  type NormalizedImageCrop,
} from "../../domain/plan/canvas/imageView";
import {
  createAnimateLayoutChanges,
  createMotionStyleTransition,
  SORTABLE_LAYOUT_TRANSITION,
} from "./canvas/dragMotion";
import { usePrefersReducedMotion } from "../../shared/hooks/usePrefersReducedMotion";

const tileButton =
  "group relative block h-full w-full overflow-hidden rounded-md border border-paper-border bg-[#e8e8e7] transition-[border-color,box-shadow] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary";

interface ReferenceImageLike {
  id: string;
  file: string;
  aspectRatio?: number;
  frameWidth?: number;
  frameHeight?: number;
  crop?: NormalizedImageCrop;
}

interface ImageFrameDimensions {
  frameWidth: number;
  frameHeight: number;
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
  onResizeFrame?: (imageId: string, frame: ImageFrameDimensions) => void;
  onResizePreview?: (
    imageId: string,
    frame: ImageFrameDimensions,
    guides: AlignmentGuides,
  ) => ImageFrameDimensions | undefined;
  onResizeCancel?: () => void;
  onSetCrop?: (imageId: string, crop: NormalizedImageCrop) => void;
  snapCandidates?: readonly Rect[];
}

const MIN_IMAGE_FRAME_SIZE = 32;
const IMAGE_SNAP_THRESHOLD_POINTS = 6;

function frameDimensions(
  image: ReferenceImageLike,
  slot: ReferenceFlowSlot,
): ImageFrameDimensions {
  return {
    frameWidth:
      Number.isFinite(image.frameWidth) && image.frameWidth! > 0
        ? image.frameWidth!
        : slot.width,
    frameHeight:
      Number.isFinite(image.frameHeight) && image.frameHeight! > 0
        ? image.frameHeight!
        : slot.height,
  };
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
  onResizeFrame,
  onResizePreview,
  onResizeCancel,
  onSetCrop,
  snapCandidates = [],
}: SortableImageTileProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    data: { type: "image", componentId },
    animateLayoutChanges: createAnimateLayoutChanges(prefersReducedMotion),
    transition: prefersReducedMotion ? undefined : SORTABLE_LAYOUT_TRANSITION,
  });
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    y: number;
    edge: ResizeEdge;
    frame: ImageFrameDimensions;
  } | null>(null);
  const [resizeSession, setResizeSession] = useState<{
    element: HTMLElement;
    pointerId: number;
  } | null>(null);
  const [adjustingView, setAdjustingView] = useState(false);
  const [cropPreview, setCropPreview] = useState<NormalizedImageCrop | null>(null);
  const cropPreviewRef = useRef<NormalizedImageCrop | null>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    crop: NormalizedImageCrop;
  } | null>(null);
  const resizePreviewRef = useRef<ImageFrameDimensions | null>(null);
  const placeholderVisible = isPlaceholder || isDragging;
  const initialFrame = frameDimensions(image, slot);
  const persistedCrop = imageCropForView({
    aspectRatio: image.aspectRatio ?? 1,
    frameWidth: initialFrame.frameWidth,
    frameHeight: initialFrame.frameHeight,
    crop: image.crop,
  });
  const displayedCrop = cropPreview ?? persistedCrop;
  const cropStyle = imageViewCss(displayedCrop);
  const adjustmentHandlers: React.ButtonHTMLAttributes<HTMLButtonElement> = adjustingView
    ? {
        onPointerDown: (event) => {
          event.preventDefault();
          event.stopPropagation();
          panStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            crop: displayedCrop,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        },
        onPointerMove: (event) => {
          const start = panStartRef.current;
          if (!start) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const nextCrop = normalizeImageCrop({
            ...start.crop,
            x: start.crop.x - (event.clientX - start.x) / rect.width * start.crop.width,
            y: start.crop.y - (event.clientY - start.y) / rect.height * start.crop.height,
          });
          cropPreviewRef.current = nextCrop;
          setCropPreview(nextCrop);
        },
        onPointerUp: (event) => {
          if (!panStartRef.current) return;
          panStartRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }
          if (cropPreviewRef.current) onSetCrop?.(image.id, cropPreviewRef.current);
        },
      }
    : {};
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
      : createMotionStyleTransition(
          prefersReducedMotion,
          draggable ? transition : undefined,
          isDragging,
        ),
  };

  const nextFrameForPointer = (
    event: React.PointerEvent<HTMLDivElement>,
  ): { frame: ImageFrameDimensions; guides: AlignmentGuides } | null => {
    if (!resizeStart) {
      return null;
    }
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const dx = (event.clientX - resizeStart.x) / safeScale;
    const dy = (event.clientY - resizeStart.y) / safeScale;
    const width = Math.max(
      MIN_IMAGE_FRAME_SIZE,
      resizeStart.frame.frameWidth +
        (resizeStart.edge === "left"
          ? -dx
          : resizeStart.edge === "right"
            ? dx
            : 0),
    );
    const height = Math.max(
      MIN_IMAGE_FRAME_SIZE,
      resizeStart.frame.frameHeight +
        (resizeStart.edge === "top"
          ? -dy
          : resizeStart.edge === "bottom"
            ? dy
            : 0),
    );
    const raw: Rect = {
      x:
        resizeStart.edge === "left"
          ? slot.x + resizeStart.frame.frameWidth - width
          : slot.x,
      y:
        resizeStart.edge === "top"
          ? slot.y + resizeStart.frame.frameHeight - height
          : slot.y,
      width,
      height,
    };
    const snapped = snapCardResize({
      rect: raw,
      candidates: snapCandidates,
      edge: resizeStart.edge,
      threshold: IMAGE_SNAP_THRESHOLD_POINTS,
      minimumWidth: MIN_IMAGE_FRAME_SIZE,
      minimumHeight: MIN_IMAGE_FRAME_SIZE,
      constrainToCanvas: false,
    });
    return {
      frame: {
        frameWidth: snapped.rect.width,
        frameHeight: snapped.rect.height,
      },
      guides: snapped.guides,
    };
  };

  const onPointerDownResize = (
    edge: ResizeEdge,
  ) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setResizeStart({
      x: event.clientX,
      y: event.clientY,
      edge,
      frame: initialFrame,
    });
    setResizeSession({ element: event.currentTarget, pointerId: event.pointerId });
    resizePreviewRef.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMoveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = nextFrameForPointer(event);
    if (!next) {
      return;
    }
    const preview =
      onResizePreview?.(image.id, next.frame, next.guides) ?? next.frame;
    resizePreviewRef.current = preview;
  };

  const finishResize = (
    event: React.PointerEvent<HTMLDivElement>,
    commit: boolean,
    releaseCapture: boolean,
  ) => {
    const session = resizeSession;
    if (!session) {
      return;
    }
    const preview = resizePreviewRef.current;
    setResizeStart(null);
    setResizeSession(null);
    resizePreviewRef.current = null;
    if (releaseCapture && session.element.hasPointerCapture(event.pointerId)) {
      session.element.releasePointerCapture?.(event.pointerId);
    }
    if (commit && preview) {
      onResizeFrame?.(image.id, preview);
    } else if (!commit) {
      onResizeCancel?.();
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
        {...(draggable && !adjustingView ? { ...attributes, ...listeners } : {})}
        {...adjustmentHandlers}
        aria-label={t("reference.selectImage", { index: index + 1 })}
        aria-pressed={selected}
        className={`${tileButton} ${
          placeholderVisible
            ? "border-2 border-dashed border-paper-primary bg-transparent"
            : selected
              ? "ring-2 ring-paper-primary ring-offset-2 ring-offset-white"
              : ""
        }`}
        onClick={(event) => {
          if (!adjustingView) onSelect(image.id, event.ctrlKey);
        }}
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
              className="absolute max-w-none"
              draggable={false}
              src={src}
              style={cropStyle}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xs text-paper-muted">
              {t("reference.loading")}
            </span>
          )}
        </div>
      </button>
      {!placeholderVisible ? (
        <button
          aria-label={adjustingView ? "完成调整视图" : "调整视图"}
          aria-pressed={adjustingView}
          className={`absolute bottom-1 right-1 z-20 rounded px-2 text-xs text-white shadow-sm transition-colors ${adjustingView ? "bg-paper-primary" : "bg-black/60 hover:bg-paper-primary"}`}
          onClick={(event) => {
            event.stopPropagation();
            if (adjustingView && cropPreviewRef.current) onSetCrop?.(image.id, cropPreviewRef.current);
            setCropPreview(null);
            cropPreviewRef.current = null;
            panStartRef.current = null;
            setAdjustingView((value) => !value);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          {adjustingView ? "完成" : "调整"}
        </button>
      ) : null}
      {!placeholderVisible ? (
        <button
          aria-label={t("reference.removeImage", { index: index + 1 })}
          className="absolute right-1 top-1 rounded-md bg-[#25272b]/85 px-2 text-xs text-white shadow-sm transition-[background-color,transform] duration-200 hover:bg-paper-danger active:scale-[0.9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={() => onRemove(image.id)}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          ×
        </button>
      ) : null}
      {!placeholderVisible ? (
        <>
          {(["left", "right", "top", "bottom"] as const).map((edge) => (
            <div
              aria-label={
                edge === "left"
                  ? t("reference.resizeImageLeft")
                  : edge === "right"
                    ? t("reference.resizeImageRight")
                    : edge === "top"
                      ? t("reference.resizeImageTop")
                      : t("reference.resizeImageBottom")
              }
              className={`absolute z-10 bg-transparent hover:bg-paper-primary/20 focus-visible:bg-paper-primary/30 ${
                edge === "left"
                  ? "left-0 top-0 h-full w-2 cursor-ew-resize"
                  : edge === "right"
                    ? "right-0 top-0 h-full w-2 cursor-ew-resize"
                    : edge === "top"
                      ? "left-0 top-0 h-2 w-full cursor-ns-resize"
                      : "bottom-0 left-0 h-2 w-full cursor-ns-resize"
              }`}
              data-image-resize-handle={edge}
              key={edge}
              onLostPointerCapture={(event) => finishResize(event, false, false)}
              onPointerCancel={(event) => finishResize(event, false, true)}
              onPointerDown={onPointerDownResize(edge)}
              onPointerMove={onPointerMoveResize}
              onPointerUp={(event) => finishResize(event, true, true)}
              role="separator"
              tabIndex={0}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
