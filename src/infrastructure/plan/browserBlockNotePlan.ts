import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import type { BlockNotePlanRepository } from "../../domain/plan/blocknote/ports";
import type { ReferenceImageStore } from "../../domain/plan/ports";
import type { PlanImagePicker } from "../../domain/plan/ports";
import type { PlanMediaStore } from "../../domain/plan/ports";

const STORAGE_KEY = "preshot.browser-blocknote-plan-v14";
const LEGACY_STORAGE_KEY = "preshot.browser-blocknote-plan-v13";
const MEDIA_STORAGE_PREFIX = "preshot.browser-blocknote-media:";
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const LANDSCAPE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAE0lEQVR4nGO4dvnif3yYYRAoAAC9iYrpFnTwwwAAAABJRU5ErkJggg==";
const PORTRAIT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGN4/vTJfxBmwGAAACm0FhtaKTEiAAAAAElFTkSuQmCC";
const browserImages = new Map<string, string>();
const browserMedia = new Map<string, string>();
let imageCounter = 0;
let mediaCounter = 0;

function dataUrlFromBytes(bytes: number[], mimeType: string): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read browser media"));
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  });
}

export const browserBlockNotePlanRepository: BlockNotePlanRepository = {
  async loadRawPlan(projectPath) {
    const encodedPath = encodeURIComponent(projectPath);
    const stored = window.sessionStorage.getItem(
      `${STORAGE_KEY}:${encodedPath}`,
    ) ?? window.sessionStorage.getItem(`${LEGACY_STORAGE_KEY}:${encodedPath}`);
    return stored ? JSON.parse(stored) : null;
  },
  async saveRawPlan(projectPath: string, plan: ProjectPlanV14) {
    window.sessionStorage.setItem(
      `${STORAGE_KEY}:${encodeURIComponent(projectPath)}`,
      JSON.stringify(plan),
    );
  },
};

export const browserBlockNoteImageStore: ReferenceImageStore = {
  async importImage() {
    imageCounter += 1;
    const file =
      `references/blocknote-${String(imageCounter).padStart(4, "0")}.png`;
    const dataUrl = imageCounter % 2 === 1 ? LANDSCAPE_PNG : PORTRAIT_PNG;
    browserImages.set(file, dataUrl);
    return {
      file,
      dataUrl,
    };
  },
  async loadImage(_projectPath, file) {
    return browserImages.get(file) ?? TINY_PNG;
  },
  async removeImage(_projectPath, file) {
    browserImages.delete(file);
  },
};

export const browserBlockNoteMediaStore: PlanMediaStore = {
  async importMedia(_projectPath, input) {
    const storedNumbers = Array.from(
      { length: window.sessionStorage.length },
      (_, index) => window.sessionStorage.key(index),
    ).flatMap((key) => {
      const match = key?.match(
        /^preshot\.browser-blocknote-media:media\/blocknote-(\d+)\./,
      );
      return match ? [Number(match[1])] : [];
    });
    mediaCounter = Math.max(mediaCounter, 0, ...storedNumbers) + 1;
    const extension = input.name.split(".").pop()?.toLowerCase() || "bin";
    const file =
      `media/blocknote-${String(mediaCounter).padStart(4, "0")}.${extension}`;
    const dataUrl = await dataUrlFromBytes(input.bytes, input.mimeType);
    browserMedia.set(file, dataUrl);
    window.sessionStorage.setItem(`${MEDIA_STORAGE_PREFIX}${file}`, dataUrl);
    return {
      file,
      dataUrl,
      name: input.name,
      mimeType: input.mimeType,
    };
  },
  async loadMedia(_projectPath, file) {
    const dataUrl = browserMedia.get(file) ??
      window.sessionStorage.getItem(`${MEDIA_STORAGE_PREFIX}${file}`);
    if (!dataUrl) throw new Error(`Unknown browser media file: ${file}`);
    return dataUrl;
  },
  async removeMedia(_projectPath, file) {
    browserMedia.delete(file);
    window.sessionStorage.removeItem(`${MEDIA_STORAGE_PREFIX}${file}`);
  },
};

export const browserBlockNoteImagePicker: PlanImagePicker = {
  async pickImageFile() {
    return String.raw`C:\memory\blocknote-import.png`;
  },
  async pickImageFiles() {
    return [
      String.raw`C:\memory\blocknote-import-1.png`,
      String.raw`C:\memory\blocknote-import-2.png`,
    ];
  },
};

export function clearBrowserBlockNotePlan(): void {
  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (
      key?.startsWith(`${STORAGE_KEY}:`) ||
      key?.startsWith(`${LEGACY_STORAGE_KEY}:`) ||
      key?.startsWith(MEDIA_STORAGE_PREFIX)
    ) {
      window.sessionStorage.removeItem(key);
    }
  }
  imageCounter = 0;
  mediaCounter = 0;
  browserImages.clear();
  browserMedia.clear();
}
