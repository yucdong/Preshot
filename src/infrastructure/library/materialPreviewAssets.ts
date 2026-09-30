import { ui } from "../../shared/i18n/ui";
import { MATERIAL_IMAGE_MAX_BYTES } from "../../domain/library/imageLimits";
import { instantiateMaterial, materialPayloadText } from "../../domain/library";
import type { MaterialDetail, MaterialImage } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import type { ProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";

const MAX_SOURCE_BYTES = MATERIAL_IMAGE_MAX_BYTES;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const PREVIEW_IMAGE_EDGE = 1600;

export function previewAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException(ui("素材预览已取消。"), "AbortError");
}

export function assertPreviewActive(signal: AbortSignal): void {
  if (signal.aborted) throw previewAbortReason(signal);
}

export function previewAbortable<T>(
  operation: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(previewAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
    if (signal.aborted) onAbort();
  });
}

function imageBytes(url: string, image: MaterialImage, display = false): Uint8Array<ArrayBuffer> {
  if (url.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 + 64) {
    throw new Error(ui("素材预览数据过大，请重新生成预览。"));
  }
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || (!display && match[1] !== image.mimeType) || match[2].length % 4 !== 0) {
    throw new Error(ui("素材图片必须是离线 PNG 或 JPEG，且类型必须与清单一致。"));
  }
  const encoded = match[2];
  const length = encoded.length / 4 * 3 -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if ((!display && length !== image.byteLength) || length > MAX_SOURCE_BYTES) {
    throw new Error(ui("素材图片大小与清单不一致，请重新保存素材。"));
  }
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function imageDimensions(bytes: Uint8Array, mime: MaterialImage["mimeType"]): {
  width: number; height: number;
} {
  if (mime === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    if (bytes.length >= 33 && signature.every((byte, index) => bytes[index] === byte)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startsOfFrame = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    let offset = 2;
    while (offset + 3 < bytes.length && bytes[offset] === 0xff) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if (startsOfFrame.has(marker) && length >= 8) {
        return {
          width: bytes[offset + 5] * 256 + bytes[offset + 6],
          height: bytes[offset + 3] * 256 + bytes[offset + 4],
        };
      }
      offset += length;
    }
  }
  throw new Error(ui("素材图片头已损坏，无法安全解码。"));
}

function validateImages(material: MaterialDetail): void {
  if (
    material.images.length !== material.imageCount ||
    material.images.length > 128 ||
    new Set(material.images.map((image) => image.localImageId)).size !== material.images.length ||
    material.payload.kind !== material.kind
  ) {
    throw new Error(ui("素材图片清单或类型与组件不一致。"));
  }
  for (const image of material.images) {
    if (
      !Number.isSafeInteger(image.byteLength) || image.byteLength <= 0 ||
      !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
      image.width <= 0 || image.height <= 0 ||
      image.width > 0xffffffff || image.height > 0xffffffff ||
      (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg")
    ) {
      throw new Error(ui("素材图片清单已损坏，请检查原图后重试。"));
    }
  }
}

// Limit only the temporary preview raster, never the original's resolution.
// Divide retained preview memory between images; decode them one at a time.
function previewSize(image: MaterialImage, count: number): { width: number; height: number } {
  const pixels = MAX_DECODED_BYTES / 4 / count;
  const scale = Math.min(1, PREVIEW_IMAGE_EDGE / Math.max(image.width, image.height),
    Math.sqrt(pixels / image.width / image.height));
  return { width: Math.max(1, Math.floor(image.width * scale)),
    height: Math.max(1, Math.floor(image.height * scale)) };
}

async function reducedPreview(bitmap: ImageBitmap, signal: AbortSignal): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error(ui("无法编码 PNG 素材缩略图，请重试。"));
    context.drawImage(bitmap, 0, 0);
    return await previewAbortable(new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob)
        : reject(new Error(ui("无法编码 PNG 素材缩略图，请重试。"))), "image/png");
    }), signal);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function previewDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  return previewAbortable(new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(ui("无法编码 PNG 素材缩略图，请重试。")));
    reader.readAsDataURL(blob);
  }), signal);
}

export interface PreparedMaterialPreview {
  plan: ProjectPlanV15;
  resolvedAssets: Record<string, string>;
  sourceTokens: ReadonlyMap<string, string>;
  text: string;
  dispose(): void;
}

export async function prepareMaterialPreview(
  repository: MaterialLibraryRepository,
  material: MaterialDetail,
  signal: AbortSignal,
  assetUrl: "blob" | "data" = "blob",
): Promise<PreparedMaterialPreview> {
  assertPreviewActive(signal);
  validateImages(material);
  const files = material.images.map((image, index) => ({
    localImageId: image.localImageId,
    file: `references/${String(index + 1).padStart(4, "0")}.${image.mimeType === "image/png" ? "png" : "jpg"}`,
  }));
  let nextId = 0;
  const localIds = new Set(files.map((file) => file.localImageId));
  const makeId = () => {
    let id: string;
    do {
      id = `material-preview-${++nextId}`;
    } while (localIds.has(id));
    return id;
  };
  // Instantiation validates the exact payload/image bijection and removes legacy outer geometry.
  const instance = instantiateMaterial(material.payload, files, makeId, "libraryCanvas");
  const plan: ProjectPlanV15 = {
    schemaVersion: 17,
    title: material.name,
    document: { format: "preshot-blocks", version: 5, blocks: [instance.block] },
    imageGroups: instance.imageGroup ? [instance.imageGroup] : [],
    artifacts: instance.artifact ? [instance.artifact] : [],
  };
  const resolvedAssets: Record<string, string> = {};
  const objectUrls: string[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    Object.keys(resolvedAssets).forEach((key) => delete resolvedAssets[key]);
  };

  try {
    for (let index = 0; index < material.images.length; index++) {
      assertPreviewActive(signal);
      const image = material.images[index];
      let cancel!: () => void;
      const cancellation = new Promise<void>(resolve => { cancel = resolve; });
      signal.addEventListener("abort", cancel, { once: true });
      let url: string;
      try {
        url = await previewAbortable(repository.loadImage(material.id, material.revision, image.localImageId,
          repository.imageRepresentation === "display" ? { edge: Math.max(previewSize(image, material.images.length).width, previewSize(image, material.images.length).height), cancellation } : undefined), signal);
      } finally { signal.removeEventListener("abort", cancel); }
      assertPreviewActive(signal);
      const display = repository.imageRepresentation === "display";
      const bytes = imageBytes(url, image, display);
      const mime = url.startsWith("data:image/png;") ? "image/png" : "image/jpeg";
      const dimensions = imageDimensions(bytes, mime);
      if (!display && (dimensions.width !== image.width || dimensions.height !== image.height)) {
        throw new Error(ui("素材图片尺寸与清单不一致，已停止预览以保护内存。"));
      }
      let blob = new Blob([bytes], { type: mime });
      const raster = { ...image, width: dimensions.width, height: dimensions.height };
      const size = previewSize(raster, material.images.length);
      const reduced = size.width !== raster.width || size.height !== raster.height;
      const decoding = createImageBitmap(blob, { imageOrientation: "none",
        ...(reduced ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" as const } : {}),
      });
      let closed = false;
      const closeBitmap = (bitmap: ImageBitmap) => {
        if (closed) return;
        closed = true;
        bitmap.close();
      };
      // A decoder cannot be cancelled; a late bitmap must still be closed after unmount.
      void decoding.then((bitmap) => {
        if (signal.aborted) closeBitmap(bitmap);
      }, () => undefined);
      const bitmap = await previewAbortable(decoding, signal);
      try {
        assertPreviewActive(signal);
        if (reduced ? bitmap.width !== size.width || bitmap.height !== size.height
          : bitmap.width * bitmap.height !== raster.width * raster.height) {
          throw new Error(ui("素材图片实际解码尺寸与清单不一致。"));
        }
        if (reduced) blob = await reducedPreview(bitmap, signal);
      } finally {
        closeBitmap(bitmap);
      }
      assertPreviewActive(signal);
      if (assetUrl === "data") {
        // Capture embeds offline images inside an SVG. Large originals use the
        // reduced raster so mounting/capture cannot decode the full source again.
        resolvedAssets[files[index].file] = reduced ? await previewDataUrl(blob, signal) : url;
      } else {
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        resolvedAssets[files[index].file] = objectUrl;
      }
    }
    return {
      plan, resolvedAssets, sourceTokens: new Map(files.map(file => [file.file, file.localImageId])),
      text: materialPayloadText(material.payload), dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
