import { createContext, useContext } from "react";
import type { ReferenceComponent } from "../../../../domain/plan/canvas/models";

export interface ImageGroupExportController {
  includeImageGroupMetadata?: boolean;
  getGroup(groupId: string): ReferenceComponent | undefined;
  getImageSrc(file: string, presentationAxes?: "raw" | "exif"): string | undefined;
}

export const ImageGroupExportContext =
  createContext<ImageGroupExportController | null>(null);

export function useOptionalImageGroupExportController():
  ImageGroupExportController | null {
  return useContext(ImageGroupExportContext);
}
