import type { ProjectPlanV13 } from "../../domain/plan/canvas/blockDocument";
import type { BlockNotePlanRepository } from "../../domain/plan/blocknote/ports";
import type { ReferenceImageStore } from "../../domain/plan/ports";
import type { PlanImagePicker } from "../../domain/plan/ports";

const STORAGE_KEY = "preshot.browser-blocknote-plan-v13";
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const LANDSCAPE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAE0lEQVR4nGO4dvnif3yYYRAoAAC9iYrpFnTwwwAAAABJRU5ErkJggg==";
const PORTRAIT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGN4/vTJfxBmwGAAACm0FhtaKTEiAAAAAElFTkSuQmCC";
const browserImages = new Map<string, string>();
let imageCounter = 0;

export const browserBlockNotePlanRepository: BlockNotePlanRepository = {
  async loadRawPlan(projectPath) {
    const stored = window.sessionStorage.getItem(
      `${STORAGE_KEY}:${encodeURIComponent(projectPath)}`,
    );
    return stored ? JSON.parse(stored) : null;
  },
  async saveRawPlan(projectPath: string, plan: ProjectPlanV13) {
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
    if (key?.startsWith(`${STORAGE_KEY}:`)) {
      window.sessionStorage.removeItem(key);
    }
  }
  imageCounter = 0;
  browserImages.clear();
}
