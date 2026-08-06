import type { ComponentFragmentPlacement } from "../../../domain/plan/canvas/engine";
import {
  DOCUMENT_TITLE_HEIGHT,
} from "../../../domain/plan/canvas/models";
import {
  DEFAULT_PAGE_GEOMETRY,
  SPACING,
} from "../../../domain/plan/canvas/geometry";
import { pageTopPx } from "./pagedCanvasMetrics";

export interface LogicalCanvasRow {
  componentIds: readonly string[];
}

export interface RowDropZoneGeometry {
  toRowIndex: number;
  topPx: number;
  heightPx: number;
}

interface RowBounds {
  topPx: number;
  bottomPx: number;
  startPageIndex: number;
}

function safeScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 0;
}

function screenTop(placement: ComponentFragmentPlacement, scale: number): number {
  return pageTopPx(placement.pageIndex, scale) + (SPACING + placement.rect.y) * scale;
}

function screenBottom(placement: ComponentFragmentPlacement, scale: number): number {
  return screenTop(placement, scale) + placement.rect.height * scale;
}

function boundsForRow(
  row: LogicalCanvasRow,
  placements: readonly ComponentFragmentPlacement[],
  scale: number,
): RowBounds | null {
  const rowPlacements = placements.filter((placement) =>
    row.componentIds.includes(placement.componentId),
  );
  if (rowPlacements.length === 0) {
    return null;
  }

  const first = rowPlacements.reduce((earliest, placement) =>
    screenTop(placement, scale) < screenTop(earliest, scale) ? placement : earliest,
  );
  const last = rowPlacements.reduce((latest, placement) =>
    screenBottom(placement, scale) > screenBottom(latest, scale) ? placement : latest,
  );

  return {
    topPx: screenTop(first, scale),
    bottomPx: screenBottom(last, scale),
    startPageIndex: first.pageIndex,
  };
}

export function rowDropZoneGeometry(
  rows: readonly LogicalCanvasRow[],
  placements: readonly ComponentFragmentPlacement[],
  scale: number,
): RowDropZoneGeometry[] {
  const scaled = safeScale(scale);
  const bounds = rows
    .map((row) => boundsForRow(row, placements, scaled))
    .filter((row): row is RowBounds => row !== null);
  if (bounds.length !== rows.length || bounds.length === 0) {
    return [];
  }

  const first = bounds[0];
  const titleEnd = first.startPageIndex === 0 ? DOCUMENT_TITLE_HEIGHT : 0;
  const beforeFirstTop = pageTopPx(first.startPageIndex, scaled) + (SPACING + titleEnd) * scaled;
  const zones: RowDropZoneGeometry[] = [
    {
      toRowIndex: 0,
      topPx: beforeFirstTop,
      heightPx: Math.max(0, first.topPx - beforeFirstTop),
    },
  ];

  for (let index = 1; index < bounds.length; index += 1) {
    const previous = bounds[index - 1];
    const current = bounds[index];
    zones.push({
      toRowIndex: index,
      topPx: previous.bottomPx,
      heightPx: Math.max(0, current.topPx - previous.bottomPx),
    });
  }

  const last = bounds.at(-1)!;
  zones.push({
    toRowIndex: bounds.length,
    topPx: last.bottomPx,
    heightPx: DEFAULT_PAGE_GEOMETRY.rowGap * scaled,
  });

  return zones;
}
