import type { ImageClipboardContents, ImageClipboardInput } from "../../domain/clipboard/imageClipboard";

const MAX_ENCODED = 16 * 1024 * 1024;
const invalid = () => new Error("图片剪贴板数据无效，请重新复制图片。");

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw invalid();
  return value;
}

function number(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw invalid();
  return value;
}

function dataUrl(value: unknown, pngOnly = false): string {
  if (typeof value !== "string") throw invalid();
  if (value.length > 4 * Math.ceil(MAX_ENCODED / 3) + 32) {
    throw new Error("图片超过剪贴板的 16 MiB 限制，请缩小图片后重试。");
  }
  const comma = value.indexOf(",");
  const header = value.slice(0, comma);
  if (!(pngOnly ? /^data:image\/png;base64$/ : /^data:image\/(png|jpeg|gif|webp);base64$/).test(header)) throw invalid();
  const body = value.slice(comma + 1);
  if (!body || body.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) throw invalid();
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  if (body.length / 4 * 3 - padding > MAX_ENCODED) {
    throw new Error("图片超过剪贴板的 16 MiB 限制，请缩小图片后重试。");
  }
  return value;
}

export function validateClipboardInput(value: unknown): ImageClipboardInput {
  const item = record(value, ["dataUrl", "name", "presentation", "nativeProps"]);
  const name = text(item.name, 255);
  if (!name.trim() || /[\\/:<>"|?*]/.test(name) ||
      Array.from(name).some((character) => character.charCodeAt(0) < 32)) throw invalid();
  const result: ImageClipboardInput = { dataUrl: dataUrl(item.dataUrl), name };
  if (item.presentation !== undefined) {
    const p = record(item.presentation, [
      "caption", "aspectRatio", "sourceWidth", "sourceHeight", "frameWidth", "frameHeight",
      "frameOffsetX", "frameOffsetY", "fitMode", "crop",
    ]);
    result.presentation = {
      aspectRatio: number(p.aspectRatio, 0.000001, 1_000_000),
      frameWidth: number(p.frameWidth, 0.000001, 1_000_000),
      frameHeight: number(p.frameHeight, 0.000001, 1_000_000),
    };
    const target = result.presentation;
    if (p.caption !== undefined) target.caption = text(p.caption, 8192);
    for (const key of ["sourceWidth", "sourceHeight"] as const) {
      if (p[key] !== undefined) target[key] = number(p[key], 1, 8192);
    }
    for (const key of ["frameOffsetX", "frameOffsetY"] as const) {
      if (p[key] !== undefined) target[key] = number(p[key], -1_000_000, 1_000_000);
    }
    if (p.fitMode !== undefined) {
      if (p.fitMode !== "cover" && p.fitMode !== "stretch") throw invalid();
      target.fitMode = p.fitMode;
    }
    if (p.crop !== undefined) {
      const c = record(p.crop, ["x", "y", "width", "height"]);
      const crop = {
        x: number(c.x, 0, 1), y: number(c.y, 0, 1),
        width: number(c.width, 0.000001, 1), height: number(c.height, 0.000001, 1),
      };
      if (crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) throw invalid();
      target.crop = crop;
    }
  }
  if (item.nativeProps !== undefined) {
    const p = record(item.nativeProps, ["caption", "textAlignment", "previewWidth"]);
    result.nativeProps = {};
    if (p.caption !== undefined) result.nativeProps.caption = text(p.caption, 8192);
    if (p.previewWidth !== undefined) result.nativeProps.previewWidth = number(p.previewWidth, 0.000001, 1_000_000);
    if (p.textAlignment !== undefined) {
      if (p.textAlignment !== "left" && p.textAlignment !== "center" && p.textAlignment !== "right") throw invalid();
      result.nativeProps.textAlignment = p.textAlignment;
    }
  }
  return result;
}

export function validateClipboardContents(value: unknown): ImageClipboardContents | null {
  if (value === null) return null;
  const item = record(value, ["original", "renderedDataUrl", "animated", "external"]);
  if (typeof item.animated !== "boolean" || typeof item.external !== "boolean") throw invalid();
  return {
    original: validateClipboardInput(item.original),
    renderedDataUrl: dataUrl(item.renderedDataUrl, true),
    animated: item.animated,
    external: item.external,
  };
}
