import type { ScreenCaptureReviewer } from "../plan/ports";
import type {
  MaterialContentUpdate,
  MaterialDetail,
  MaterialEditImage,
  MaterialEditSession,
  MaterialInsertCommit,
  MaterialInsertRequest,
  MaterialInsertStatus,
  MaterialMetadata,
  MaterialPayload,
  MaterialPreviewInput,
  MaterialSaveRequest,
  MaterialSearch,
  MaterialSearchResult,
  MaterialSummary,
  PreparedMaterialInsert,
} from "./models";
import type { ReferenceImageCropBounds } from "../plan/ports";

export interface MaterialContentEditorRepository {
  beginCreate(payload: MaterialPayload): Promise<MaterialEditSession>;
  beginEdit(materialId: string, revision: number): Promise<MaterialEditSession>;
  loadEditImage(sessionId: string, localImageId: string): Promise<string>;
  revealEditImage?(sessionId: string, localImageId: string): Promise<void>;
  revealEditImageGroup?(sessionId: string): Promise<void>;
  importEditImages(sessionId: string, onSelected?: (total: number) => void): Promise<MaterialEditImage[]>;
  importLibraryImages?(sessionId: string, materialId: string, revision: number, imageIds: string[]): Promise<MaterialEditImage[]>;
  /** Encoded JPG/PNG only; each paste owns a new draft and persistent image file. */
  importEditImageData?(
    sessionId: string, input: { name: string; mimeType: string; bytes: number[] },
  ): Promise<MaterialEditImage>;
  /** Resolving cancellation stops capture; null means explicitly cancelled, never a failure. */
  captureEditImage(sessionId: string, cancellation: Promise<void>, review?: ScreenCaptureReviewer): Promise<MaterialEditImage | null>;
  cropEditImage(
    sessionId: string, localImageId: string, bounds: ReferenceImageCropBounds,
  ): Promise<MaterialEditImage>;
  commitEdit(input: MaterialContentUpdate): Promise<MaterialDetail>;
  discardEdit(sessionId: string): Promise<void>;
}

export interface MaterialLibraryRepository {
  /** Desktop sources are bounded display rasters, with original metadata kept separately. */
  readonly imageRepresentation?: "display";
  readonly availability: "desktop" | "test" | "unavailable";
  readonly contentEditor?: MaterialContentEditorRepository;
  search(input: MaterialSearch): Promise<MaterialSearchResult>;
  get(id: string): Promise<MaterialDetail>;
  save(input: MaterialSaveRequest): Promise<MaterialDetail>;
  updateMetadata(
    id: string, expectedVersion: number, metadata: MaterialMetadata,
  ): Promise<MaterialSummary>;
  setDeleted(id: string, expectedVersion: number, deleted: boolean): Promise<MaterialSummary>;
  purge(id: string, expectedVersion: number): Promise<void>;
  loadImage(id: string, revision: number, localImageId: string, display?: { edge: number; cancellation?: Promise<void> }): Promise<string>;
  revealImage?(id: string, revision: number, localImageId: string): Promise<void>;
  revealImageGroup?(id: string, revision: number): Promise<void>;
  loadPreview(id: string, revision: number): Promise<string | null>;
  savePreview(id: string, revision: number, preview: MaterialPreviewInput): Promise<void>;
  markPreviewFailed(id: string, revision: number): Promise<void>;
  prepareInsert(input: MaterialInsertRequest): Promise<PreparedMaterialInsert>;
  commitInsert(input: MaterialInsertCommit): Promise<void>;
  abortInsert(projectPath: string, operationId: string): Promise<void>;
  getInsertStatus(projectPath: string, operationId: string): Promise<MaterialInsertStatus>;
}
