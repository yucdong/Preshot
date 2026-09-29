export const COLUMN_GAP = 20;
export const COLUMN_MIN_EDIT_WIDTH = 120;
export const COLUMN_MIN_EXPORT_WIDTH = 48;

/** Export keeps the page width fixed. Reject impossible layouts without clipping. */
export function columnExportWidths(weights: readonly number[], available: number, gap = COLUMN_GAP): number[] {
  const maximum = Math.max(...weights);
  if (weights.length < 2 || !Number.isFinite(available) || available <= 0 ||
    weights.some(weight => !Number.isFinite(weight) || weight <= 0)) throw new Error("Invalid column weights or page width");
  const normalized = weights.map(weight => weight / maximum);
  const sum = normalized.reduce((total, weight) => total + weight, 0);
  const usable = available - gap * (weights.length - 1);
  const widths = normalized.map(weight => usable * weight / sum);
  if (widths.some(width => !Number.isFinite(width) || width < COLUMN_MIN_EXPORT_WIDTH)) {
    throw new Error("Columns are too narrow for this export page. Widen narrow columns or move some columns into a separate row before exporting.");
  }
  return widths;
}
