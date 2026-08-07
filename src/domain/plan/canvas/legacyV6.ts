/**
 * The v6 persisted shape is retained only while migrating old plans and
 * generating the temporary paged PDF layout. New application state uses v7
 * card rectangles from models.ts.
 */
export interface LegacyV6ReferenceImage {
  id: string;
  file: string;
  caption?: string;
  aspectRatio: number;
  displayHeight?: number;
}

export interface LegacyV6BaseComponent {
  id: string;
  name: string;
  width: number;
  contentScale: number;
}

export interface LegacyV6PlanTextComponent extends LegacyV6BaseComponent {
  type: "plan";
  html: string;
}

export interface LegacyV6ReferenceComponent extends LegacyV6BaseComponent {
  type: "reference";
  description: string;
  showDescription: boolean;
  imageHeight: number;
  images: LegacyV6ReferenceImage[];
}

export type LegacyV6PlanComponent =
  | LegacyV6PlanTextComponent
  | LegacyV6ReferenceComponent;

export interface LegacyV6ProjectPlan {
  schemaVersion: 6;
  title: string;
  components: LegacyV6PlanComponent[];
}
