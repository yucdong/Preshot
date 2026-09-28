import type { PlanDependencies } from "../../src/features/plan/blocknote/dependencies";
import type { ImageClipboardContents } from "../../src/domain/clipboard/imageClipboard";
import type { ImagePasteFile } from "../../src/domain/clipboard/projectImagePaste";
import type { ProjectPlanV15 } from "../../src/domain/plan/canvas/blockDocument";
import type { ImageClipboardTestControls } from "./imageClipboardTestControls";

export function installImageClipboardBoundary(dependencies: PlanDependencies): void {
  if (import.meta.env.MODE !== "e2e") throw new Error("Clipboard boundary is E2E-only");
  let clipboard: ImageClipboardContents | null = null;
  const assets = new Map<string, string>();
  const operations = new Map<string, {
    projectPath: string; expected: string; file: ImagePasteFile;
    status: "prepared" | "committed" | "aborted";
  }>();
  let sequence = 9000;
  const original = dependencies.service;
  const key = (project: string, file: string) => `${project}\0${file}`;
  dependencies.service = {
    ...original,
    loadImage: async (project, file) => assets.get(key(project, file)) ?? original.loadImage(project, file),
    loadMedia: async (project, file) => assets.get(key(project, file)) ?? original.loadMedia(project, file),
  };
  dependencies.imageClipboard = {
    availability: "test",
    async write(image) {
      clipboard = { original: structuredClone(image), renderedDataUrl: image.dataUrl, animated: false, external: false };
    },
    async read() { return clipboard ? structuredClone(clipboard) : null; },
    async hasImage() { return clipboard !== null; },
  };
  document.addEventListener("copy", (event) => {
    queueMicrotask(() => { if (!event.defaultPrevented) clipboard = null; });
  }, true);
  async function checkBase(project: string, expected: ProjectPlanV15) {
    const result = await original.loadPlan(project, expected.title);
    if (result.status === "incompatible" || JSON.stringify(result.plan) !== JSON.stringify(expected)) {
      throw new Error("Clipboard fixture project changed");
    }
  }
  dependencies.imagePasteRepository = {
    async prepareImagePaste(input) {
      await checkBase(input.projectPath, input.expectedPlan);
      if (operations.has(input.operationId)) throw new Error("Clipboard fixture operation reused");
      if (!["image/jpeg", "image/png"].includes(input.image.mimeType)) throw new Error("Clipboard fixture supports only JPEG and PNG");
      const suffix = input.image.mimeType === "image/jpeg" ? "jpg" : "png";
      const file: ImagePasteFile = {
        operationId: input.operationId, name: input.image.name, mimeType: input.image.mimeType,
        file: input.destination === "references" ? `references/${++sequence}.${suffix}` : `media/${crypto.randomUUID()}.${suffix}`,
      };
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid fixture clipboard image"));
        reader.readAsDataURL(new Blob([new Uint8Array(input.image.bytes)], { type: input.image.mimeType }));
      });
      assets.set(key(input.projectPath, file.file), dataUrl);
      operations.set(input.operationId, {
        projectPath: input.projectPath, expected: JSON.stringify(input.expectedPlan), file, status: "prepared",
      });
      return file;
    },
    async commitImagePaste(input) {
      const operation = operations.get(input.operationId);
      if (!operation || operation.projectPath !== input.projectPath || operation.status !== "prepared" ||
          operation.expected !== JSON.stringify(input.expectedPlan)) throw new Error("Invalid fixture paste");
      await checkBase(input.projectPath, input.expectedPlan);
      await original.savePlan(input.projectPath, input.nextPlan);
      operation.status = "committed";
    },
    async getImagePasteStatus(_project, id) { return operations.get(id)?.status ?? "missing"; },
    async abortImagePaste(project, id) {
      const operation = operations.get(id);
      if (!operation) return;
      if (operation.projectPath !== project || operation.status === "committed") throw new Error("Cannot abort committed fixture paste");
      assets.delete(key(project, operation.file.file));
      operation.status = "aborted";
    },
  };
  const controls: ImageClipboardTestControls = {
    copied: () => clipboard !== null,
    files: () => [...operations.values()].filter(operation => operation.status === "committed").map(operation => operation.file.file),
  };
  window.__PRESHOT_IMAGE_CLIPBOARD_TEST__ = controls;
}
