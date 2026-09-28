export interface ImportedImage {
  file: string;
  dataUrl: string;
}

export interface ReferenceImageStore {
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
  file: string;
  dataUrl: string;
  name: string;
  mimeType: string;
}

export interface PlanMediaStore {
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
  | { status: "captured"; path: string };

export interface ScreenCapture {
  /** Capture and copy a PNG into project-local native media; cancellation drains cleanup. */
  captureMedia?(projectPath: string, cancellation: Promise<void>): Promise<ImportedPlanMedia | null>;
  start(): Promise<string>;
  poll(token: string): Promise<ScreenCapturePollResult>;
  cancel(token: string): Promise<void>;
  discard(path: string): Promise<void>;
}
