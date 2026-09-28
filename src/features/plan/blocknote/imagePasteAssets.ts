import type { ClipboardImagePresentation, ImageClipboardContents, ImagePasteTarget } from "../../../domain/clipboard/imageClipboard";
import { imageClipboardFilename } from "../../../domain/clipboard/imageClipboard";
import type { ImagePasteBytes } from "../../../domain/clipboard/projectImagePaste";
import { measureImageDimensions } from "./imageHydration";

export async function clipboardPasteAsset(contents: ImageClipboardContents, target: ImagePasteTarget): Promise<{
  image: ImagePasteBytes;
  dataUrl: string;
  dimensions: { width: number; height: number };
  presentation?: ClipboardImagePresentation;
}> {
  const original = contents.original.dataUrl;
  const convert = target.kind === "document"
    ? Boolean(contents.original.presentation)
    : contents.animated || !/^data:image\/(?:jpeg|png);base64,/.test(original);
  const dataUrl = convert ? contents.renderedDataUrl : original;
  if (dataUrl.length > Math.ceil(16 * 1024 * 1024 / 3) * 4 + 100) throw new Error("复制图片超过 16 MiB，请使用较小的图片。");
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new Error("剪贴板图片格式无效，请重新复制。");
  const decoded = atob(match[2]);
  if (!decoded.length || decoded.length > 16 * 1024 * 1024) throw new Error("剪贴板图片数据超过安全限制。");
  const mimeType = match[1];
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6);
  // Measure the already-decoded static representation for animated native files.
  const measured = await measureImageDimensions(
    contents.animated && target.kind === "document" ? contents.renderedDataUrl : dataUrl,
  );
  const dimensions = { width: measured.sourceWidth, height: measured.sourceHeight };
  const baseName = imageClipboardFilename(contents.original.name).replace(/\.(png|jpe?g|gif|webp)$/i, "");
  const presentation = contents.original.presentation;
  return {
    image: { name: `${baseName}.${extension}`, mimeType, bytes: Array.from(decoded, char => char.charCodeAt(0)) },
    dataUrl, dimensions,
    presentation: target.kind !== "gallery" || !presentation ? undefined : convert
      ? { ...presentation, aspectRatio: dimensions.width / dimensions.height,
          sourceWidth: dimensions.width, sourceHeight: dimensions.height,
          crop: { x: 0, y: 0, width: 1, height: 1 } }
      : presentation,
  };
}
