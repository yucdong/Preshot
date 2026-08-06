import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeCrop } from "../../domain/plan/canvas/crop";
import type { CropRect } from "../../domain/plan/canvas/models";

interface ImageCropOverlayProps {
  crop: CropRect | undefined;
  sourceAspectRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  onPreview(crop: CropRect): void;
  onCommit(crop: CropRect): void;
  onCancel(): void;
  onReset(): void;
}

type CropEdge = "top" | "right" | "bottom" | "left";

interface DragSession {
  edge: CropEdge;
  pointerId: number;
  startX: number;
  startY: number;
  crop: CropRect;
}

const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const minimumCropLength = 0.01;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cropForEdge(session: DragSession, clientX: number, clientY: number, sourceAspectRatio: number, viewportWidth: number, viewportHeight: number): CropRect {
  const sourceWidth = sourceAspectRatio > 0 && Number.isFinite(sourceAspectRatio) ? sourceAspectRatio : 1;
  const width = Math.max(viewportWidth, 1);
  const height = Math.max(viewportHeight, 1);
  const deltaX = ((clientX - session.startX) / (width / (sourceWidth * session.crop.width))) / sourceWidth;
  const deltaY = (clientY - session.startY) / (height / session.crop.height);
  const next = { ...session.crop };

  if (session.edge === "right") {
    next.width = clamp(session.crop.width + deltaX, minimumCropLength, 1 - session.crop.x);
  } else if (session.edge === "left") {
    next.x = clamp(session.crop.x + deltaX, 0, session.crop.x + session.crop.width - minimumCropLength);
    next.width = session.crop.x + session.crop.width - next.x;
  } else if (session.edge === "bottom") {
    next.height = clamp(session.crop.height + deltaY, minimumCropLength, 1 - session.crop.y);
  } else {
    next.y = clamp(session.crop.y + deltaY, 0, session.crop.y + session.crop.height - minimumCropLength);
    next.height = session.crop.y + session.crop.height - next.y;
  }

  return normalizeCrop(next) ?? fullCrop;
}

export function ImageCropOverlay({
  crop,
  sourceAspectRatio,
  viewportWidth,
  viewportHeight,
  onPreview,
  onCommit,
  onCancel,
  onReset,
}: ImageCropOverlayProps) {
  const { t } = useTranslation();
  const dragSession = useRef<DragSession | undefined>(undefined);
  const [previewCrop, setPreviewCrop] = useState<CropRect>();
  const displayedCrop = previewCrop ?? crop ?? fullCrop;

  function stopInteraction(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  function beginDrag(edge: CropEdge, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    stopInteraction(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragSession.current = {
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      crop: displayedCrop,
    };
  }

  function previewDrag(event: React.PointerEvent<HTMLButtonElement>) {
    stopInteraction(event);
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    const nextCrop = cropForEdge(session, event.clientX, event.clientY, sourceAspectRatio, viewportWidth, viewportHeight);
    setPreviewCrop(nextCrop);
    onPreview(nextCrop);
  }

  function commitDrag(event: React.PointerEvent<HTMLButtonElement>) {
    stopInteraction(event);
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    const nextCrop = cropForEdge(session, event.clientX, event.clientY, sourceAspectRatio, viewportWidth, viewportHeight);
    dragSession.current = undefined;
    setPreviewCrop(undefined);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onCommit(nextCrop);
  }

  function cancelDrag(event: React.PointerEvent<HTMLButtonElement>) {
    stopInteraction(event);
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    dragSession.current = undefined;
    setPreviewCrop(undefined);
    onCancel();
  }

  const handles: Array<{ edge: CropEdge; className: string; label: string }> = [
    { edge: "top", className: "left-1/2 top-0 h-2 w-8 -translate-x-1/2 -translate-y-1/2", label: t("reference.cropTop") },
    { edge: "right", className: "right-0 top-1/2 h-8 w-2 translate-x-1/2 -translate-y-1/2", label: t("reference.cropRight") },
    { edge: "bottom", className: "bottom-0 left-1/2 h-2 w-8 -translate-x-1/2 translate-y-1/2", label: t("reference.cropBottom") },
    { edge: "left", className: "left-0 top-1/2 h-8 w-2 -translate-x-1/2 -translate-y-1/2", label: t("reference.cropLeft") },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <div
        aria-hidden="true"
        className="absolute border-2 border-amber-400"
        style={{
          left: `${displayedCrop.x * 100}%`,
          top: `${displayedCrop.y * 100}%`,
          width: `${displayedCrop.width * 100}%`,
          height: `${displayedCrop.height * 100}%`,
        }}
      />
      {handles.map(({ edge, className, label }) => (
        <button
          aria-label={label}
          className={`pointer-events-auto absolute rounded-full bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-100 ${className}`}
          data-testid={`crop-handle-${edge}`}
          key={edge}
          onClick={stopInteraction}
          onLostPointerCapture={cancelDrag}
          onPointerCancel={cancelDrag}
          onPointerDown={(event) => beginDrag(edge, event)}
          onPointerMove={previewDrag}
          onPointerUp={commitDrag}
          type="button"
        />
      ))}
      {crop ? (
        <button
          aria-label={t("reference.resetCrop")}
          className="pointer-events-auto absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-100"
          onClick={(event) => {
            stopInteraction(event);
            onReset();
          }}
          onPointerDown={stopInteraction}
          type="button"
        >
          {t("reference.resetCrop")}
        </button>
      ) : null}
    </div>
  );
}
