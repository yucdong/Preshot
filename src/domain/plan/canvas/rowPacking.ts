import {
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  SPACING,
  type PageGeometry,
} from "./geometry";
import {
  normalizeFraction,
  ROW_CAPACITY_EPSILON,
} from "./fraction";

export function rowGapFraction(
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): number {
  const width = contentSize(geometry).width;
  return width > 0 ? normalizeFraction(SPACING / width) : 0;
}

export function usedRowWidth(
  widths: readonly number[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): number {
  return normalizeFraction(
    widths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, widths.length - 1) * rowGapFraction(geometry),
  );
}

export function nextRowItemOffset(
  widths: readonly number[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): number {
  return normalizeFraction(
    usedRowWidth(widths, geometry) +
      (widths.length > 0 ? rowGapFraction(geometry) : 0),
  );
}

export function rowFits(
  widths: readonly number[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): boolean {
  return usedRowWidth(widths, geometry) <= 1 + ROW_CAPACITY_EPSILON;
}

export function canAddToRow(
  widths: readonly number[],
  width: number,
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): boolean {
  return Number.isFinite(width) && width > 0 && rowFits([...widths, width], geometry);
}

export function remainingRowWidth(
  widths: readonly number[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): number {
  return Math.max(0, normalizeFraction(1 - usedRowWidth(widths, geometry)));
}

export function maximumAdditionalWidth(
  widths: readonly number[],
  geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY,
): number {
  return Math.max(
    0,
    normalizeFraction(
      remainingRowWidth(widths, geometry) -
        (widths.length > 0 ? rowGapFraction(geometry) : 0),
    ),
  );
}
