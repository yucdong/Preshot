import { defaultAnimateLayoutChanges } from "@dnd-kit/sortable";
import {
  createImageDragTransition,
  IMAGE_DRAG_TOKENS,
} from "../imageDragMotion";

export const DRAG_ACTIVATION_CONSTRAINT = {
  delay: IMAGE_DRAG_TOKENS.touchActivationDelayMs,
  tolerance: IMAGE_DRAG_TOKENS.touchActivationTolerance,
} as const;
export const SORTABLE_LAYOUT_TRANSITION = {
  duration: IMAGE_DRAG_TOKENS.reflowDurationMs,
  easing: IMAGE_DRAG_TOKENS.easing,
} as const;

export function createAnimateLayoutChanges(prefersReducedMotion: boolean) {
  return (args: Parameters<typeof defaultAnimateLayoutChanges>[0]) =>
    prefersReducedMotion ? false : defaultAnimateLayoutChanges(args);
}

export function createMotionStyleTransition(
  prefersReducedMotion: boolean,
  sortableTransition?: string | null,
  isDragging = false,
): string | undefined {
  if (prefersReducedMotion) {
    return undefined;
  }

  const imageTransition = createImageDragTransition({
    isDragging,
    prefersReducedMotion,
  });
  return sortableTransition && !isDragging
    ? `${sortableTransition}, ${imageTransition}`
    : imageTransition;
}
