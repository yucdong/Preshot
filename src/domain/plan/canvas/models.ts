import { normalizeFraction } from "./fraction";

export const MIN_COMPONENT_HEIGHT = 80; // points
export const DEFAULT_PLAN_HEIGHT = 220; // points
export const DEFAULT_REFERENCE_HEIGHT = 320; // points
export const MIN_COMPONENT_WIDTH = 120; // points

// These values and clamps are retained for v1-v6 migration and the temporary
// paged PDF adapter. They are not fields in the v7 persisted schema.
export const DEFAULT_IMAGE_HEIGHT = 135; // points
export const MIN_IMAGE_HEIGHT = 67.5; // points
export const MAX_IMAGE_HEIGHT = 400; // points
export const MIN_REFERENCE_IMAGE_DISPLAY_HEIGHT = 32; // points
export const DOCUMENT_TITLE_HEIGHT = 36; // points
export const UNTITLED_PLAN_TITLE = "未命名方案";

export const DEFAULT_WIDTH = 1;
export const MIN_WIDTH = 0.15;

/** Content scaling is persisted for future component controls, not yet rendered. */
export const MIN_CONTENT_SCALE = 0.5;
export const MAX_CONTENT_SCALE = 2;
export const DEFAULT_CONTENT_SCALE = 1;

export const CURRENT_SCHEMA_VERSION = 10 as const;

export function clampHeight(height: number, maxHeight: number): number {
  if (!Number.isFinite(height)) {
    return MIN_COMPONENT_HEIGHT;
  }
  return Math.max(MIN_COMPONENT_HEIGHT, Math.min(maxHeight, height));
}

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return MIN_WIDTH;
  }
  return normalizeFraction(Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, width)));
}

export function clampImageHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return MIN_IMAGE_HEIGHT;
  }
  return Math.min(MAX_IMAGE_HEIGHT, Math.max(MIN_IMAGE_HEIGHT, height));
}

export function clampReferenceImageDisplayHeight(height: number, imageHeight: number): number {
  const maximum = clampImageHeight(imageHeight);
  const minimum = Math.min(MIN_REFERENCE_IMAGE_DISPLAY_HEIGHT, maximum);
  if (!Number.isFinite(height)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, height));
}

export function clampContentScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return DEFAULT_CONTENT_SCALE;
  }
  return Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, scale));
}

export interface ReferenceImage {
  id: string;
  file: string;
  /** Preserved from v1-v6, but intentionally not rendered by the v7 UI or PDF. */
  caption?: string;
  aspectRatio: number;
  /** Independent frame dimensions in canvas points; they do not derive from aspectRatio. */
  frameWidth: number;
  frameHeight: number;
}

export interface BaseComponent {
  id: string;
  name: string;
  /** Horizontal offset and dimensions inside the printable A4 content box. */
  x: number;
  width: number;
  height: number;
}

export interface PlanTextLeaf {
  kind: "leaf";
  id: string;
  html: string;
}

export interface PlanTextSplit {
  kind: "split";
  id: string;
  direction: "columns" | "rows";
  gap: number;
  children: [PlanTextNode, PlanTextNode];
}

export type PlanTextNode = PlanTextLeaf | PlanTextSplit;

export interface PlanTextComponent extends BaseComponent {
  type: "plan";
  /** Optional per-component content scale; values below 1 compact text to fit one page. */
  contentScale?: number;
  textRoot: PlanTextNode;
}

export interface ReferenceComponent extends BaseComponent {
  type: "reference";
  /** Group introduction. It is always available to the UI and may be empty. */
  description: string;
  images: ReferenceImage[];
}

export type PlanComponent = PlanTextComponent | ReferenceComponent;

export interface ProjectPlan {
  schemaVersion: 10;
  title: string;
  components: PlanComponent[];
}

export const EMPTY_PLAN: ProjectPlan = {
  schemaVersion: 10,
  title: UNTITLED_PLAN_TITLE,
  components: [],
};
