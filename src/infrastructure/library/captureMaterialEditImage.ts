import type { MaterialEditImage } from "../../domain/library/models";
import type { ScreenCapture, ScreenCaptureReviewer } from "../../domain/plan/ports";
import { captureScreenImage } from "../plan/captureScreenImage";

export function captureMaterialEditImage(
  screenCapture: ScreenCapture,
  cancellation: Promise<void>,
  importImage: (path: string) => Promise<MaterialEditImage>,
  review?: ScreenCaptureReviewer,
): Promise<MaterialEditImage | null> {
  return captureScreenImage(screenCapture, cancellation, importImage, review);
}
