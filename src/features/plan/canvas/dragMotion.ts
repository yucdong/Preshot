import { defaultAnimateLayoutChanges } from "@dnd-kit/sortable";

export const DRAG_ACTIVATION_CONSTRAINT = { delay: 180, tolerance: 6 } as const;
export const SORTABLE_LAYOUT_TRANSITION = { duration: 200, easing: "ease-out" } as const;

const LAYOUT_STYLE_TRANSITION = [
  `left ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
  `top ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
  `width ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
  `height ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
  `opacity ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
  `border-color ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
  `background-color ${SORTABLE_LAYOUT_TRANSITION.duration}ms ${SORTABLE_LAYOUT_TRANSITION.easing}`,
].join(", ");

export function createAnimateLayoutChanges(prefersReducedMotion: boolean) {
  return (args: Parameters<typeof defaultAnimateLayoutChanges>[0]) =>
    prefersReducedMotion ? false : defaultAnimateLayoutChanges(args);
}

export function createMotionStyleTransition(
  prefersReducedMotion: boolean,
  sortableTransition?: string | null,
): string | undefined {
  if (prefersReducedMotion) {
    return undefined;
  }

  return sortableTransition ? `${sortableTransition}, ${LAYOUT_STYLE_TRANSITION}` : LAYOUT_STYLE_TRANSITION;
}
