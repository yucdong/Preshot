export interface DropRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Determines whether to insert the active component after the over component
 * based on their vertical positions. Component flow is vertical, so insertAfter
 * is true when the active component's vertical center is past the over component's
 * vertical center.
 */
export function insertAfterFromRects(activeRect: DropRect, overRect: DropRect): boolean {
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const overCenterY = overRect.top + overRect.height / 2;
  return activeCenterY > overCenterY;
}
