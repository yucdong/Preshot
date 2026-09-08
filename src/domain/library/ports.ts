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
  importEditImages(sessionId: string): Promise<MaterialEditImage[]>;
  /** Resolving cancellation stops capture; null means explicitly cancelled, never a failure. */
  captureEditImage(sessionId: string, cancellation: Promise<void>): Promise<MaterialEditImage | null>;
  cropEditImage(
    sessionId: string, localImageId: string, bounds: ReferenceImageCropBounds,
  ): Promise<MaterialEditImage>;
  commitEdit(input: MaterialContentUpdate): Promise<MaterialDetail>;
  discardEdit(sessionId: string): Promise<void>;
}

export interface MaterialLibraryRepository {
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
  loadImage(id: string, revision: number, localImageId: string): Promise<string>;
  loadPreview(id: string, revision: number): Promise<string | null>;
  savePreview(id: string, revision: number, preview: MaterialPreviewInput): Promise<void>;
  markPreviewFailed(id: string, revision: number): Promise<void>;
  prepareInsert(input: MaterialInsertRequest): Promise<PreparedMaterialInsert>;
  commitInsert(input: MaterialInsertCommit): Promise<void>;
  abortInsert(projectPath: string, operationId: string): Promise<void>;
  getInsertStatus(projectPath: string, operationId: string): Promise<MaterialInsertStatus>;
}
