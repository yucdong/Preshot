export type DocxImageType = "bmp" | "gif" | "jpg" | "png";

export interface PreparedDocxImage {
  readonly type: DocxImageType;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function readJpegDimensions(bytes: Uint8Array): {
  readonly width: number;
  readonly height: number;
} | undefined {
  let offset = 2;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (sofMarkers.has(marker)) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      };
    }
    offset += length;
  }
  return undefined;
}

export function docxImageInfo(bytes: Uint8Array): PreparedDocxImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      type: "png",
      bytes,
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return {
      type: "gif",
      bytes,
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
    };
  }
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return {
      type: "bmp",
      bytes,
      width: Math.abs(view.getInt32(18, true)),
      height: Math.abs(view.getInt32(22, true)),
    };
  }
  if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dimensions = readJpegDimensions(bytes);
    if (dimensions) {
      return { type: "jpg", bytes, ...dimensions };
    }
  }
  throw new Error(
    "DOCX native image data must be a valid PNG, JPEG, GIF, BMP, or WebP.",
  );
}

function isWebP(bytes: Uint8Array, mime: string): boolean {
  return mime.toLowerCase() === "image/webp" ||
    (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to encode WebP as PNG for DOCX export."));
    }, "image/png");
  });
}

export async function prepareDocxImage(blob: Blob): Promise<PreparedDocxImage> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isWebP(bytes, blob.type)) return docxImageInfo(bytes);

  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error("Decoded WebP dimensions are invalid for DOCX export.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("Unable to create the WebP conversion canvas.");
    }
    context.drawImage(bitmap, 0, 0);
    const png = await canvasPng(canvas);
    return docxImageInfo(new Uint8Array(await png.arrayBuffer()));
  } finally {
    bitmap.close();
  }
}
