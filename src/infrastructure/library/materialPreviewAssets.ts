import { ui } from "../../shared/i18n/ui";
import { instantiateMaterial, materialPayloadText } from "../../domain/library";
import type { MaterialDetail, MaterialImage } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import type { ProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;

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

function imageBytes(url: string, image: MaterialImage): Uint8Array<ArrayBuffer> {
  if (url.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 + 64) {
    throw new Error(ui("素材图片超过 16 MiB，请重新保存较小的图片。"));
  }
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || match[1] !== image.mimeType || match[2].length % 4 !== 0) {
    throw new Error(ui("素材图片必须是离线 PNG 或 JPEG，且类型必须与清单一致。"));
  }
  const encoded = match[2];
  const length = encoded.length / 4 * 3 -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (length !== image.byteLength || length > MAX_SOURCE_BYTES) {
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
  let decoded = 0;
  let sourceBytes = 0;
  for (const image of material.images) {
    if (
      !Number.isSafeInteger(image.byteLength) || image.byteLength <= 0 ||
      image.byteLength > MAX_SOURCE_BYTES ||
      !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
      image.width <= 0 || image.height <= 0 ||
      image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION ||
      (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg")
    ) {
      throw new Error(ui("素材图片超过安全限制（单张 16 MiB、边长 8192 像素），或清单已损坏。"));
    }
    decoded += image.width * image.height * 4;
    sourceBytes += image.byteLength;
  }
  if (decoded > MAX_DECODED_BYTES) {
    throw new Error(ui("素材图片解码内存超过 256 MiB，请减少图片数量或尺寸。"));
  }
  if (sourceBytes > MAX_DECODED_BYTES) {
    throw new Error(ui("素材图片源数据超过 256 MiB，请减少图片数量或尺寸。"));
  }
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
    schemaVersion: 15,
    title: material.name,
    document: { format: "preshot-blocks", version: 3, blocks: [instance.block] },
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
      const url = await previewAbortable(
        repository.loadImage(material.id, material.revision, image.localImageId),
        signal,
      );
      assertPreviewActive(signal);
      const bytes = imageBytes(url, image);
      const dimensions = imageDimensions(bytes, image.mimeType);
      if (dimensions.width !== image.width || dimensions.height !== image.height) {
        throw new Error(ui("素材图片尺寸与清单不一致，已停止预览以保护内存。"));
      }
      const blob = new Blob([bytes], { type: image.mimeType });
      const decoding = createImageBitmap(blob, { imageOrientation: "none" });
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
        if (bitmap.width * bitmap.height !== image.width * image.height) {
          throw new Error(ui("素材图片实际解码尺寸与清单不一致。"));
        }
      } finally {
        closeBitmap(bitmap);
      }
      assertPreviewActive(signal);
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      resolvedAssets[files[index].file] = objectUrl;
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
