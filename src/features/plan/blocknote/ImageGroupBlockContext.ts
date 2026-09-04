import { createContext, useContext } from "react";
import type {
  ImageFitMode,
  ReferenceComponent,
} from "../../../domain/plan/canvas/models";

export interface ImageGroupBlockController {
  selectedImageId?: string | null;
  createGroup(): string;
  subscribe(listener: () => void): () => void;
  cloneGroup(sourceGroupId: string): string | null;
  removeBlock?(blockId: string): void;
  getGroup(groupId: string): ReferenceComponent | undefined;
  getImageSrc(file: string): string | undefined;
  addImages(groupId: string): void;
  captureImage?(groupId: string): void;
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
  resizeGroup(
    groupId: string,
    frame: {
      x: number;
      width: number;
      height: number;
      frameOffsetY: number;
    },
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
