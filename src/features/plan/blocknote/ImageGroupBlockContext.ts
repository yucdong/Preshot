import { createContext, useContext } from "react";
import type { ImageImportProgressState } from "./ImageImportProgress";
import type {
  ImageFitMode,
  ReferenceComponent,
} from "../../../domain/plan/canvas/models";

export interface ImageGroupBlockController {
  /** Internal image editing remains available when document structure is locked. */
  structureEditable?: boolean;
  singleImage?: boolean;
  selectedImageId?: string | null;
  createGroup(): string;
  subscribe(listener: () => void): () => void;
  cloneGroup(sourceGroupId: string): string | null;
  removeBlock?(blockId: string): void;
  saveBlock?(blockId: string): void;
  saveImage?(groupId: string, imageId: string): void;
  revealImage?(groupId: string, imageId: string): void;
  revealImageGroup?(): void;
  revealImageGroupDisabled?: boolean;
  getGroup(groupId: string): ReferenceComponent | undefined;
  getImageSrc(file: string, presentationAxes?: "raw" | "exif"): string | undefined;
  getImportProgress?(groupId: string): ImageImportProgressState | undefined;
  addImages(groupId: string, maxFrameWidth?: number): void;
  insertImagesFromLibrary?(groupId: string): void;
  captureImage?(groupId: string, maxFrameWidth?: number): void;
  removeImage(groupId: string, imageId: string): void;
  selectImage?(imageId: string): void;
  openImage(groupId: string, imageId: string, file: string): void;
  setImageFrame(
    groupId: string,
    imageId: string,
    frame: {
      frameWidth: number;
      frameHeight: number;
      frameOffsetX: number;
      frameOffsetY: number;
      groupHeight?: number;
    },
  ): void;
  setImageFitMode?(
    groupId: string,
    imageId: string,
    fitMode: ImageFitMode,
  ): void;
  moveImage(
    fromGroupId: string,
    imageId: string,
    toGroupId: string,
    toIndex: number,
  ): void;
}

export const ImageGroupBlockContext =
  createContext<ImageGroupBlockController | null>(null);

export function useImageGroupBlockController(): ImageGroupBlockController {
  const controller = useContext(ImageGroupBlockContext);
  if (!controller) {
    throw new Error("Image-group block controller is unavailable");
  }
  return controller;
}
