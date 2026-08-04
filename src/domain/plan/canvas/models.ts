export type WidthFraction = "1" | "3/4" | "2/3" | "1/2" | "1/3" | "1/4";

export const WIDTH_FRACTIONS: WidthFraction[] = ["1", "3/4", "2/3", "1/2", "1/3", "1/4"];

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const DEFAULT_COLUMNS = 3;

export const MIN_COMPONENT_HEIGHT = 80; // points
export const DEFAULT_PLAN_HEIGHT = 220; // points
export const DEFAULT_REFERENCE_HEIGHT = 320; // points

export const DEFAULT_IMAGE_HEIGHT = 180; // points
export const MIN_IMAGE_HEIGHT = 80; // points
export const MAX_IMAGE_HEIGHT = 400; // points

export const DEFAULT_WIDTH = 1;
export const MIN_WIDTH = 0.15;

export const CURRENT_SCHEMA_VERSION = 2 as const;

export function fractionValue(fraction: WidthFraction): number {
  const [num, den] = fraction.split("/");
  return den === undefined ? Number(num) : Number(num) / Number(den);
}

export function snapWidthFraction(ratio: number): WidthFraction {
  let best: WidthFraction = WIDTH_FRACTIONS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fraction of WIDTH_FRACTIONS) {
    const distance = Math.abs(fractionValue(fraction) - ratio);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = fraction;
    }
  }
  return best;
}

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) {
    return MIN_COLUMNS;
  }
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns)));
}

export function clampHeight(height: number, maxHeight: number): number {
  if (!Number.isFinite(height)) {
    return MIN_COMPONENT_HEIGHT;
  }
  return Math.max(MIN_COMPONENT_HEIGHT, Math.min(maxHeight, height));
}

export function clampWidth(width: number): number {
  return Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, width));
}

export function clampImageHeight(height: number): number {
  return Math.min(MAX_IMAGE_HEIGHT, Math.max(MIN_IMAGE_HEIGHT, height));
}

export interface ReferenceImage {
  id: string;
  file: string;
  caption?: string;
  aspectRatio?: number;
}

export interface BaseComponent {
  id: string;
  widthFraction: WidthFraction;
  width?: number; // continuous width fraction, optional this task
  height: number; // A4 points
}

export interface PlanTextComponent extends BaseComponent {
  type: "plan";
  html: string;
}

export interface ReferenceComponent extends BaseComponent {
  type: "reference";
  title: string;
  description: string;
  columnsPerRow: number;
  showCaptions: boolean;
  images: ReferenceImage[];
  imageHeight?: number; // optional this task
}

export type PlanComponent = PlanTextComponent | ReferenceComponent;

export interface ProjectPlan {
  schemaVersion: 2;
  components: PlanComponent[];
}

export const EMPTY_PLAN: ProjectPlan = { schemaVersion: 2, components: [] };

/**
 * Returns the effective width of a component, bridging new continuous width
 * with the legacy widthFraction fallback.
 */
export function effectiveWidth(component: BaseComponent): number {
  return component.width ?? fractionValue(component.widthFraction);
}
