const PDF_IMAGE_DPI = 144;
const PDF_POINTS_PER_INCH = 72;
const PDF_JPEG_QUALITY = 0.76;

export interface PdfImageDrawBox {
  width: number;
  height: number;
}

export interface PdfImageView {
  crop?: { x: number; y: number; width: number; height: number };
}

export interface OptimizedPdfImage {
  mime: string;
  bytes: Uint8Array;
}

export type PdfImageOptimizer = (
  dataUrl: string,
  drawBox: PdfImageDrawBox,
  view?: PdfImageView,
) => Promise<OptimizedPdfImage>;

export function imageDataFromDataUrl(dataUrl: string): OptimizedPdfImage {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Unsupported image data URL");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mime: match[1], bytes };
}

export function pdfImagePixelBounds(drawBox: PdfImageDrawBox): {
  width: number;
  height: number;
} {
  const pixelsPerPoint = PDF_IMAGE_DPI / PDF_POINTS_PER_INCH;
  const dimension = (value: number) =>
    Math.max(1, Math.ceil((Number.isFinite(value) && value > 0 ? value : 0) * pixelsPerPoint));
  return {
    width: dimension(drawBox.width),
    height: dimension(drawBox.height),
  };
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to decode a reference image for PDF export"));
  });
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    await loaded;
  }
  return image;
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Unable to compress a reference image for PDF export"));
        }
      },
      mime,
      quality,
    );
  });
}

export const optimizePdfImage: PdfImageOptimizer = async (dataUrl, drawBox, view) => {
  const image = await loadImage(dataUrl);
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("Reference image dimensions are invalid for PDF export");
  }

  const bounds = pdfImagePixelBounds(drawBox);
  const width = bounds.width;
  const height = bounds.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Unable to create an image compression canvas for PDF export");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const crop = view?.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  context.drawImage(
    image,
    crop.x * image.naturalWidth,
    crop.y * image.naturalHeight,
    crop.width * image.naturalWidth,
    crop.height * image.naturalHeight,
    0,
    0,
    width,
    height,
  );

  const blob = await canvasBlob(canvas, "image/jpeg", PDF_JPEG_QUALITY);
  return {
    mime: "image/jpeg",
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
};
