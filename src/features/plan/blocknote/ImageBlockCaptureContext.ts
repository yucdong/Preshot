import { createContext } from "react";
import type { ImportedPlanMedia } from "../../../domain/plan/ports";

export interface ImageCaptureTarget {
  isCurrent(): boolean;
  publish(media: ImportedPlanMedia): void;
}

export type CaptureBlockImage = (target: ImageCaptureTarget) => Promise<void>;
export const CaptureBlockImageContext = createContext<CaptureBlockImage | undefined>(undefined);
