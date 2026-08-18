export interface ImportedImage {
  file: string;
  dataUrl: string;
}

export interface ReferenceImageStore {
  importImage(projectPath: string, sourcePath: string): Promise<ImportedImage>;
  loadImage(projectPath: string, file: string): Promise<string>;
  removeImage(projectPath: string, file: string): Promise<void>;
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

export interface ReferenceImageCropTransaction {
  image: OverwrittenReferenceImage;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ReferenceImageCropStore {
  beginImageCrop(
    projectPath: string,
    input: {
      file: string;
      bounds: ReferenceImageCropBounds;
    },
  ): Promise<ReferenceImageCropTransaction>;
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
  | { status: "captured"; path: string };

export interface ScreenCapture {
  start(): Promise<string>;
  poll(token: string): Promise<ScreenCapturePollResult>;
  cancel(token: string): Promise<void>;
  discard(path: string): Promise<void>;
}
