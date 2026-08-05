import type { ComponentFragmentPlacement } from "../../../domain/plan/canvas/engine";

export function pageCountForDisplayedPlacements(
  placements: ComponentFragmentPlacement[],
  fallbackPageCount: number,
): number {
  const highestPageIndex = placements.reduce(
    (max, placement) => Math.max(max, placement.pageIndex),
    -1,
  );

  return Math.max(fallbackPageCount, highestPageIndex + 1);
}
