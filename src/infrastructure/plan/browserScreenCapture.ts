import { ui } from "../../shared/i18n/ui";
import { captureScreenImage } from "./captureScreenImage";
import { browserBlockNoteMediaStore } from "./browserBlockNotePlan";
import type { ScreenCapture } from "../../domain/plan/ports";

export function createBrowserScreenCapture(): ScreenCapture {
  const active = new Set<string>();
  let sequence = 0;

  const capture: ScreenCapture = {
    async captureMedia(projectPath, cancellation) {
      return captureScreenImage(capture, cancellation, () => browserBlockNoteMediaStore.importMedia(projectPath, {
        name: ui("截图.png"), mimeType: "image/png",
        bytes: Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0)),
      }));
    },
    async start() {
      const token = `browser-capture-${(sequence += 1)}`;
      active.add(token);
      return token;
    },
    async poll(token) {
      if (!active.delete(token)) {
        throw new Error("Unknown screen capture session");
      }
      return {
        status: "captured",
        path: String.raw`C:\memory\capture.png`,
      };
    },
    async cancel(token) {
      active.delete(token);
    },
    async discard() {},
  };
  return capture;
}
