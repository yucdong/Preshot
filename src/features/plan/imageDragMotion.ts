import type { CSSProperties } from "react";
import type { ReferenceImage } from "../../domain/plan/canvas/models";

export const IMAGE_DRAG_TOKENS = {
  mouseActivationDistance: 6,
  touchActivationDelayMs: 180,
  touchActivationTolerance: 6,
  reflowDurationMs: 200,
  dropDurationMs: 200,
  easing: "ease-out",
  targetBorderColor: "var(--app-functional)",
  targetBackgroundColor: "var(--app-functional-soft)",
  targetRing:
    "0 0 0 2px color-mix(in srgb, var(--app-functional) 18%, transparent)",
  overlayWidth: 176,
  autoScrollEdge: 48,
  autoScrollHysteresis: 8,
  autoScrollMaxSpeed: 18,
} as const;

const layoutProperties = [
  "left",
  "top",
  "width",
  "height",
  "opacity",
  "border-color",
  "background-color",
] as const;
const dragProperties = ["transform", "opacity"] as const;

function transitionFor(
  properties: readonly string[],
  durationMs: number,
): string {
  return properties
    .map(
      (property) =>
        `${property} ${durationMs}ms ${IMAGE_DRAG_TOKENS.easing}`,
    )
    .join(", ");
}

export function createImageDragTransition(input: {
  isDragging: boolean;
  prefersReducedMotion: boolean;
}): string {
  if (input.prefersReducedMotion) return "none";
  return input.isDragging
    ? transitionFor(dragProperties, IMAGE_DRAG_TOKENS.dropDurationMs)
    : transitionFor(
        layoutProperties,
        IMAGE_DRAG_TOKENS.reflowDurationMs,
      );
}

export function createImageDragMotionStyle(input: {
  isDragging: boolean;
  prefersReducedMotion: boolean;
  opacity?: number;
  transform?: string;
}): CSSProperties {
  return {
    opacity: input.opacity,
    transform: input.transform,
    transition: createImageDragTransition(input),
  };
}

export function imageDragDropAnimation(prefersReducedMotion: boolean) {
  return {
    duration: prefersReducedMotion ? 0 : IMAGE_DRAG_TOKENS.dropDurationMs,
    easing: IMAGE_DRAG_TOKENS.easing,
  };
}

export function imageDragOverlayGeometry(
  image: Pick<
    ReferenceImage,
    "aspectRatio" | "frameHeight" | "frameWidth"
  >,
) {
  const frameRatio =
    Number.isFinite(image.frameWidth) &&
      image.frameWidth > 0 &&
      Number.isFinite(image.frameHeight) &&
      image.frameHeight > 0
      ? image.frameWidth / image.frameHeight
      : Number.isFinite(image.aspectRatio) && image.aspectRatio > 0
        ? image.aspectRatio
        : 1;
  return {
    width: IMAGE_DRAG_TOKENS.overlayWidth,
    height: IMAGE_DRAG_TOKENS.overlayWidth / frameRatio,
  };
}

export function imageDragAutoScrollVelocity(
  point: { readonly x: number; readonly y: number },
  viewport: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
) {
  const axisVelocity = (
    coordinate: number,
    start: number,
    end: number,
  ) => {
    const edge = IMAGE_DRAG_TOKENS.autoScrollEdge;
    if (coordinate < start + edge) {
      return -IMAGE_DRAG_TOKENS.autoScrollMaxSpeed *
        Math.min(1, Math.max(0, (start + edge - coordinate) / edge));
    }
    if (coordinate > end - edge) {
      return IMAGE_DRAG_TOKENS.autoScrollMaxSpeed *
        Math.min(1, Math.max(0, (coordinate - (end - edge)) / edge));
    }
    return 0;
  };
  return {
    x: axisVelocity(point.x, viewport.left, viewport.right),
    y: axisVelocity(point.y, viewport.top, viewport.bottom),
  };
}
