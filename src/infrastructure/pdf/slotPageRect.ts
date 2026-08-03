import type { Rect } from "../../domain/plan/canvas/geometry";

/**
 * Converts a rectangle from component-relative top-down coordinates (y=0 at component top, y grows downward)
 * to pdf-lib page coordinates (y=0 at page bottom, y grows upward).
 *
 * @param contentRect The component's content area in page coordinates (y-up)
 * @param box The rectangle in component coordinates (y-down)
 * @returns The rectangle in page coordinates (y-up)
 */
export function slotToPageRect(contentRect: Rect, box: Rect): Rect {
  return {
    x: contentRect.x + box.x,
    y: contentRect.y + contentRect.height - box.y - box.height,
    width: box.width,
    height: box.height,
  };
}
