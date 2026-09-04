export interface NormalizedImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageViewRenderSpec {
  source: { x: number; y: number; width: number; height: number };
  destination: { width: number; height: number };
}

const PRECISION = 1_000_000;

function rounded(value: number) {
  return Math.round(value * PRECISION) / PRECISION;
}

function positive(value: number | undefined, fallback = 1) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function clamped(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeImageCrop(crop: NormalizedImageCrop): NormalizedImageCrop {
  const width = clamped(positive(crop.width), 1 / PRECISION, 1);
  const height = clamped(positive(crop.height), 1 / PRECISION, 1);
  const x = clamped(Number.isFinite(crop.x) ? crop.x : 0, 0, 1 - width);
  const y = clamped(Number.isFinite(crop.y) ? crop.y : 0, 0, 1 - height);
  return {
    x: rounded(x),
    y: rounded(y),
    width: rounded(width),
    height: rounded(height),
  };
}

export function cropForFrame(input: {
  sourceAspectRatio: number;
  frameAspectRatio: number;
  focusX?: number;
  focusY?: number;
  zoom?: number;
}): NormalizedImageCrop {
  const sourceRatio = positive(input.sourceAspectRatio);
  const frameRatio = positive(input.frameAspectRatio);
  const zoom = Math.max(1, positive(input.zoom));
  const base = frameRatio >= sourceRatio
    ? { width: 1, height: sourceRatio / frameRatio }
    : { width: frameRatio / sourceRatio, height: 1 };
  const width = base.width / zoom;
  const height = base.height / zoom;
  const focusX = clamped(input.focusX ?? 0.5, width / 2, 1 - width / 2);
  const focusY = clamped(input.focusY ?? 0.5, height / 2, 1 - height / 2);
  return normalizeImageCrop({
    x: focusX - width / 2,
    y: focusY - height / 2,
    width,
    height,
  });
}

export function centeredCoverCrop(
  sourceAspectRatio: number,
  frameAspectRatio: number,
): NormalizedImageCrop {
  return cropForFrame({ sourceAspectRatio, frameAspectRatio });
}

export function imageCropForView(image: {
  aspectRatio: number;
  frameWidth: number;
  frameHeight: number;
  crop?: NormalizedImageCrop;
}) {
  return image.crop
    ? normalizeImageCrop(image.crop)
    : centeredCoverCrop(
        image.aspectRatio,
        positive(image.frameWidth) / positive(image.frameHeight),
      );
}

export function cropFocus(crop: NormalizedImageCrop) {
  const normalized = normalizeImageCrop(crop);
  return {
    x: normalized.x + normalized.width / 2,
    y: normalized.y + normalized.height / 2,
  };
}

export function cropZoom(
  crop: NormalizedImageCrop,
  sourceAspectRatio: number,
  frameAspectRatio: number,
) {
  const normalized = normalizeImageCrop(crop);
  const base = centeredCoverCrop(sourceAspectRatio, frameAspectRatio);
  return Math.max(1, Math.min(base.width / normalized.width, base.height / normalized.height));
}

export function cropForResizedFrame(
  image: {
    aspectRatio: number;
    frameWidth: number;
    frameHeight: number;
    crop?: NormalizedImageCrop;
  },
  nextFrame: { frameWidth: number; frameHeight: number },
) {
  const crop = imageCropForView(image);
  const focus = cropFocus(crop);
  const zoom = cropZoom(
    crop,
    image.aspectRatio,
    positive(image.frameWidth) / positive(image.frameHeight),
  );
  return cropForFrame({
    sourceAspectRatio: image.aspectRatio,
    frameAspectRatio: positive(nextFrame.frameWidth) / positive(nextFrame.frameHeight),
    focusX: focus.x,
    focusY: focus.y,
    zoom,
  });
}

export function imageViewRenderSpec(input: {
  sourceWidth: number;
  sourceHeight: number;
  crop: NormalizedImageCrop;
  destinationWidth: number;
  destinationHeight: number;
}): ImageViewRenderSpec {
  const sourceWidth = positive(input.sourceWidth);
  const sourceHeight = positive(input.sourceHeight);
  const crop = normalizeImageCrop(input.crop);
  return {
    source: {
      x: rounded(crop.x * sourceWidth),
      y: rounded(crop.y * sourceHeight),
      width: rounded(crop.width * sourceWidth),
      height: rounded(crop.height * sourceHeight),
    },
    destination: {
      width: positive(input.destinationWidth),
      height: positive(input.destinationHeight),
    },
  };
}

export function imageViewCss(crop: NormalizedImageCrop) {
  const normalized = normalizeImageCrop(crop);
  return {
    width: `${100 / normalized.width}%`,
    height: `${100 / normalized.height}%`,
    left: `${(-normalized.x / normalized.width) * 100}%`,
    top: `${(-normalized.y / normalized.height) * 100}%`,
  };
}

export function imageFrameContentCss(image: {
  aspectRatio: number;
  frameWidth: number;
  frameHeight: number;
  fitMode?: "cover" | "stretch";
  crop?: NormalizedImageCrop;
}) {
  return image.fitMode === "stretch"
    ? {
        width: "100%",
        height: "100%",
        left: "0%",
        top: "0%",
      }
    : imageViewCss(imageCropForView(image));
}
