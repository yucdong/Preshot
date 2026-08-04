export const MIN_COMPONENT_HEIGHT = 80; // points
export const DEFAULT_PLAN_HEIGHT = 220; // points
export const DEFAULT_REFERENCE_HEIGHT = 320; // points

export const DEFAULT_IMAGE_HEIGHT = 180; // points
export const MIN_IMAGE_HEIGHT = 80; // points
export const MAX_IMAGE_HEIGHT = 400; // points

export const DEFAULT_WIDTH = 1;
export const MIN_WIDTH = 0.15;

export const CURRENT_SCHEMA_VERSION = 3 as const;

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
  aspectRatio: number;
}

export interface BaseComponent {
  id: string;
  width: number; // continuous width fraction (0, 1]
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
  showCaptions: boolean;
  images: ReferenceImage[];
  imageHeight: number;
}

export type PlanComponent = PlanTextComponent | ReferenceComponent;

export interface ProjectPlan {
  schemaVersion: 3;
  components: PlanComponent[];
}

export const EMPTY_PLAN: ProjectPlan = { schemaVersion: 3, components: [] };
