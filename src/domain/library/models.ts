import type { ReferenceImage } from "../plan/canvas/models";
import type { ProjectPlanV15 } from "../plan/canvas/blockDocument";

export const MATERIAL_KINDS = [
  "imageGroup", "shootingLocation", "modelCard", "prop", "clothing",
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export type PortableImage = Omit<ReferenceImage, "id" | "file"> & {
  localImageId: string;
};
export interface PortableCollection {
  images: PortableImage[];
}
export type PortableComponent =
  | { kind: "imageGroup"; name: string; description: string; images: PortableImage[] }
  | {
      kind: "shootingLocation";
      venueName: string;
      address: string;
      description: string;
      gallery: PortableCollection;
    }
  | {
      kind: "modelCard";
      modelId: string;
      heightCm: number | null;
      weightKg: number | null;
      shoeSize: string;
      notes?: string;
      samples: PortableCollection;
    }
  | { kind: "prop"; title: string; source: string; gallery: PortableCollection }
  | { kind: "clothing"; title: string; source: string; mainGallery: PortableCollection };

export interface MaterialPayload {
  format: "preshot-material";
  version: 1;
  kind: MaterialKind;
  component: PortableComponent;
}
export interface MaterialImageSource {
  localImageId: string;
  file: string;
}
export interface MaterialSnapshot {
  sourceBlockId: string;
  payload: MaterialPayload;
  sources: MaterialImageSource[];
  omittedLegacyImages: number;
}
export interface MaterialMetadata {
  name: string;
  description: string;
  tags: string[];
  favorite: boolean;
}
export interface MaterialSummary extends MaterialMetadata {
  id: string;
  kind: MaterialKind;
  revision: number;
  metadataVersion: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  imageCount: number;
  byteLength: number;
  previewState: "pending" | "ready" | "failed";
  previewPartial?: boolean;
}
export interface MaterialImage {
  localImageId: string;
  blobId: string;
  mimeType: "image/jpeg" | "image/png";
  byteLength: number;
  width: number;
  height: number;
}
export interface MaterialDetail extends MaterialSummary {
  payload: MaterialPayload;
  images: MaterialImage[];
}
export interface MaterialEditSession {
  sessionId: string;
  /** Creation drafts are not library records; their material has both versions at zero. */
  isNew?: boolean;
  material: MaterialDetail;
}
export interface MaterialEditImage {
  localImageId: string;
  mimeType: "image/jpeg" | "image/png";
  byteLength: number;
  width: number;
  height: number;
  dataUrl: string;
}
export interface MaterialContentUpdate {
  operationId: string;
  sessionId: string;
  payload: MaterialPayload;
  metadataUpdate?: {
    expectedVersion: number;
    metadata: MaterialMetadata;
  };
}
export class MaterialContentSaveError extends Error {
  constructor(
    message: string,
    readonly outcome: "rejected" | "unknown",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MaterialContentSaveError";
  }
}
export interface MaterialSearch {
  query: string;
  exactName?: string;
  kind?: MaterialKind;
  favorites?: boolean;
  trash?: boolean;
  sort: "relevance" | "recent" | "name";
  offset: number;
  limit: number;
}
export interface MaterialSearchResult {
  items: MaterialSummary[];
  total: number;
  indexState: "ready" | "rebuilding";
}
export interface MaterialSaveRequest {
  operationId: string;
  projectId: string;
  projectPath: string;
  expectedPlan: ProjectPlanV15;
  snapshot: MaterialSnapshot;
  metadata: MaterialMetadata;
}
export interface MaterialInsertRequest {
  operationId: string;
  materialId: string;
  revision: number;
  projectId: string;
  projectPath: string;
  expectedPlan: ProjectPlanV15;
}
export interface PreparedMaterialInsert {
  operationId: string;
  materialId: string;
  revision: number;
  payload: MaterialPayload;
  images: MaterialImageSource[];
}
export interface MaterialInsertCommit {
  operationId: string;
  projectId: string;
  projectPath: string;
  expectedPlan: ProjectPlanV15;
  nextPlan: ProjectPlanV15;
}
export type MaterialInsertStatus = "prepared" | "committed" | "cancelled" | "conflict";
export interface MaterialPreviewInput {
  bytes: number[];
  width: number;
  height: number;
  renderKey: string;
  isPartial: boolean;
}
