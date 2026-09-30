import { cropForResizedFrame } from "./imageView";
import type { BlockProps } from "./blockDocument";
import type { ReferenceImage } from "./models";

export function nativeImagePresentation(props: BlockProps, sourceWidth: number, sourceHeight: number): ReferenceImage {
  const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
  const width = typeof props.previewWidth === "number" && props.previewWidth > 0 ? props.previewWidth : Math.min(sourceWidth || 600, 1008);
  const result: ReferenceImage = { id: "presentation", file: "", aspectRatio: ratio, sourceWidth, sourceHeight,
    ...(props.presentationAxes === "exif" || props.presentationAxes === "raw" ? { presentationAxes: props.presentationAxes } : {}),
    frameWidth: width, frameHeight: typeof props.previewHeight === "number" && props.previewHeight > 0 ? props.previewHeight : width / ratio,
    fitMode: props.fitMode === "stretch" ? "stretch" : "cover",
    crop: { x: typeof props.cropX === "number" ? props.cropX : 0, y: typeof props.cropY === "number" ? props.cropY : 0,
      width: typeof props.cropWidth === "number" ? props.cropWidth : 1, height: typeof props.cropHeight === "number" ? props.cropHeight : 1 },
  };
  if (result.fitMode !== "stretch") result.crop = cropForResizedFrame(result, { frameWidth: result.frameWidth, frameHeight: result.frameHeight });
  return result;
}

export function nativeImagePresentationProps(image: Pick<ReferenceImage, "frameWidth" | "frameHeight" | "fitMode" | "crop" | "presentationAxes">): BlockProps {
  return { previewWidth: image.frameWidth, previewHeight: image.frameHeight, fitMode: image.fitMode ?? "cover",
    cropX: image.crop?.x ?? 0, cropY: image.crop?.y ?? 0, cropWidth: image.crop?.width ?? 1, cropHeight: image.crop?.height ?? 1,
    ...(image.presentationAxes ? { presentationAxes: image.presentationAxes } : {}) };
}
