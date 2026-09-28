import type { ReferenceImage } from "../plan/canvas/models";

export function imageClipboardFilename(label: string): string {
  const leaf = label.normalize("NFC").split(/[\\/]/).at(-1) ?? "";
  const extension = leaf.match(/\.(png|jpe?g|gif|webp)$/i)?.[0].toLowerCase() ?? ".png";
  const stem = leaf.replace(/\.(png|jpe?g|gif|webp)$/i, "");
  const base = Array.from(stem).map(character => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) || '<>:"|?*%'.includes(character) ? "-" : character;
  }).slice(0, 48).join("").trim().replace(/[. ]+$/, "") || "image";
  const prefix = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? "image-" : "";
  return `${prefix}${base}${extension}`;
}

export type ClipboardImagePresentation = Omit<ReferenceImage, "id" | "file">;

export interface ClipboardNativeImageProps {
  caption?: string;
  textAlignment?: "left" | "center" | "right";
  previewWidth?: number;
}

export interface ImageClipboardInput {
  dataUrl: string;
  name: string;
  presentation?: ClipboardImagePresentation;
  nativeProps?: ClipboardNativeImageProps;
}

export interface ImageClipboardContents {
  original: ImageClipboardInput;
  renderedDataUrl: string;
  animated: boolean;
  external: boolean;
}

export interface ImageClipboardPort {
  readonly availability: "desktop" | "test" | "unavailable";
  write(image: ImageClipboardInput): Promise<void>;
  read(): Promise<ImageClipboardContents | null>;
  hasImage(): Promise<boolean>;
}

export const unavailableImageClipboard: ImageClipboardPort = {
  availability: "unavailable",
  async write() { throw new Error("当前环境不支持系统图片剪贴板，请在桌面应用中使用。"); },
  async read() { throw new Error("当前环境不支持系统图片剪贴板，请在桌面应用中使用。"); },
  async hasImage() { return false; },
};

export type ImageClipboardSelection =
  | { kind: "gallery"; groupId: string; imageId: string }
  | { kind: "native"; blockId: string };

export type ImagePasteTarget =
  | { kind: "gallery"; groupId: string; afterImageId: string | null; maxFrameWidth?: number }
  | { kind: "document"; afterBlockId: string | null };
