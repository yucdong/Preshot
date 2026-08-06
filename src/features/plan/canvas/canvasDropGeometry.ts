export interface DropRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Determines whether to insert the active component after the over component
 * based on horizontal positions within a logical row.
 */
export function insertAfterFromRects(activeRect: DropRect, overRect: DropRect): boolean {
  const activeCenterX = activeRect.left + activeRect.width / 2;
  const overCenterX = overRect.left + overRect.width / 2;
  return activeCenterX > overCenterX;
}
