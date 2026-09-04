import { type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import {
  imageFrameContentCss,
} from "../../../domain/plan/canvas/imageView";
import { usePrefersReducedMotion } from "../../../shared/hooks/usePrefersReducedMotion";
import {
  createImageDragMotionStyle,
  imageDragOverlayGeometry,
} from "../imageDragMotion";

export interface ImageDragOverlayProps {
  image: ReferenceImage;
  decodedSource?: string | null;
  localSource?: string | null;
  source?: string | null;
  className?: string;
  portalContainer?: Element | null;
  portalToBody?: boolean;
  style?: CSSProperties;
}

function resolveImageDragOverlaySource({
  decodedSource,
  localSource,
  source,
}: Pick<
  ImageDragOverlayProps,
  "decodedSource" | "localSource" | "source"
>): string | undefined {
  return decodedSource || localSource || source || undefined;
}

export function ImageDragOverlay({
  className,
  decodedSource,
  image,
  localSource,
  portalContainer,
  portalToBody = false,
  source,
  style,
}: ImageDragOverlayProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const geometry = imageDragOverlayGeometry(image);
  const resolvedSource = resolveImageDragOverlaySource({
    decodedSource,
    localSource,
    source,
  });
  const content = (
    <div
      aria-hidden="true"
      className={[
        "preshot-image-drag-overlay",
        className,
      ].filter(Boolean).join(" ")}
      data-image-drag-overlay="true"
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      style={{
        ...createImageDragMotionStyle({
          isDragging: true,
          prefersReducedMotion,
        }),
        height: geometry.height,
        pointerEvents: "none",
        width: geometry.width,
        ...style,
      }}
    >
      <div className="preshot-image-drag-overlay-frame">
        {resolvedSource ? (
          <img
            alt=""
            className="preshot-image-drag-overlay-image"
            draggable={false}
            src={resolvedSource}
            style={imageFrameContentCss(image)}
          />
        ) : (
          <span className="preshot-image-drag-overlay-fallback">加载中…</span>
        )}
      </div>
    </div>
  );

  const target =
    portalContainer ??
    (portalToBody && typeof document !== "undefined" ? document.body : null);
  return target ? createPortal(content, target) : content;
}
