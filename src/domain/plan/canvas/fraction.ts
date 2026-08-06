export const ROW_CAPACITY_EPSILON = 1e-9;

const FRACTION_PRECISION = 1e12;

export function normalizeFraction(value: number): number {
  const rounded = Math.round(value * FRACTION_PRECISION) / FRACTION_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}
