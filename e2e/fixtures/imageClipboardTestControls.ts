export interface ImageClipboardTestControls {
  files(): string[];
  copied(): boolean;
}

declare global {
  interface Window {
    __PRESHOT_IMAGE_CLIPBOARD_TEST__?: ImageClipboardTestControls;
  }
}
