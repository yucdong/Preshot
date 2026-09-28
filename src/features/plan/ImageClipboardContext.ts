import { createContext, useContext } from "react";
import type { ImageClipboardPort } from "../../domain/clipboard/imageClipboard";

export const ImageClipboardContext = createContext<ImageClipboardPort | null>(null);
export function useImageClipboardPort(): ImageClipboardPort | null {
  return useContext(ImageClipboardContext);
}
