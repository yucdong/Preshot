export interface ImportedImage {
  file: string;
  dataUrl: string;
}

export interface ReferenceImageStore {
  importImage(projectPath: string, sourcePath: string): Promise<ImportedImage>;
  loadImage(projectPath: string, file: string): Promise<string>;
  removeImage(projectPath: string, file: string): Promise<void>;
}

export interface PlanImagePicker {
  pickImageFile(title: string): Promise<string | null>;
}
