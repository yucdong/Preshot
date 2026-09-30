export interface ImportedImage {
  previewError?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  file: string;
  dataUrl: string;
}

export interface ReferenceImageStore {
  imageDisplay?(projectPath: string, file: string, edge: number, cancellation?: Promise<void>): Promise<string>;
  imageDimensions?(projectPath: string, file: string): Promise<{ sourceWidth: number; sourceHeight: number }>;
  importImage(projectPath: string, sourcePath: string): Promise<ImportedImage>;
  loadImage(projectPath: string, file: string): Promise<string>;
  removeImage(projectPath: string, file: string): Promise<void | "removed" | "retainedForMaterialHistory">;
}

export interface ReferenceImageCropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverwrittenReferenceImage extends ImportedImage {
  width: number;
  height: number;
}

export interface CopiedReferenceImage extends ImportedImage {
  width: number;
  height: number;
}

export interface ReferenceImageCropTransaction {
  image: OverwrittenReferenceImage;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ReferenceImageCropStore {
  isImageRetainedForHistory?(projectPath: string, file: string): Promise<boolean>;
  beginImageCrop(
    projectPath: string,
    input: {
      file: string;
      bounds: ReferenceImageCropBounds;
    },
  ): Promise<ReferenceImageCropTransaction>;
  copyImageCrop?(
    projectPath: string,
    input: {
      file: string;
      bounds: ReferenceImageCropBounds;
    },
  ): Promise<CopiedReferenceImage>;
}

export interface ImportedPlanMedia {
  previewError?: string;
  file: string;
  dataUrl: string;
  name: string;
  mimeType: string;
}

export interface PlanMediaStore {
  importImageStream?(projectPath: string, name: string, size: number, chunks: AsyncIterable<Uint8Array>): Promise<ImportedPlanMedia>;
  importMedia(
    projectPath: string,
    input: {
      name: string;
      mimeType: string;
      bytes: number[];
    },
  ): Promise<ImportedPlanMedia>;
  loadMedia(projectPath: string, file: string): Promise<string>;
  removeMedia(projectPath: string, file: string): Promise<void>;
}

export interface PlanImagePicker {
  pickImageFile(title: string): Promise<string | null>;
  pickImageFiles(title?: string): Promise<string[]>;
}

export type ScreenCapturePollResult =
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "captured"; path: string; review?: ScreenCaptureReviewImage };

export interface ScreenCaptureReviewImage {
  reason: "uniformDark" | "transparent";
  previewUrl: string;
}
export type ScreenCaptureReviewer = (image: ScreenCaptureReviewImage, cancellation: Promise<void>) => Promise<"keep" | "retry" | "cancel">;

export interface ScreenCapture {
  /** Capture and copy a PNG into project-local native media; cancellation drains cleanup. */
  captureMedia?(projectPath: string, cancellation: Promise<void>, review?: ScreenCaptureReviewer): Promise<ImportedPlanMedia | null>;
  start(): Promise<string>;
  poll(token: string): Promise<ScreenCapturePollResult>;
  cancel(token: string): Promise<void>;
  discard(path: string): Promise<void>;
}
