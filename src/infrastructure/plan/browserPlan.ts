import type { ImportedImage, PlanImagePicker, ReferenceImageStore } from "../../domain/plan/ports";
import { planLogger } from "../../shared/logging/logger";
import { createCanvasPlanService, type CanvasPlanService } from "../../domain/plan/canvas/service";
import type { CanvasPlanRepository } from "../../domain/plan/canvas/ports";
import type { ProjectPlan as CanvasPlan } from "../../domain/plan/canvas/models";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const LANDSCAPE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='100' viewBox='0 0 160 100'><rect width='160' height='100' fill='%23d6d3d1'/></svg>";
const PORTRAIT_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='160' viewBox='0 0 100 160'><rect width='100' height='160' fill='%23e7e5e4'/></svg>";
const LANDSCAPE_ALT_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='110' viewBox='0 0 180 110'><rect width='180' height='110' fill='%23cbd5e1'/></svg>";
const PORTRAIT_ALT_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='110' height='170' viewBox='0 0 110 170'><rect width='110' height='170' fill='%23f5d0fe'/></svg>";
const SEEDED_IMAGE_DATA: Record<string, string> = {
  "references/0001.png": LANDSCAPE_SVG,
  "references/0002.png": PORTRAIT_SVG,
  "references/0003.png": LANDSCAPE_ALT_SVG,
  "references/0004.png": PORTRAIT_ALT_SVG,
};

const SEEDED_V4_PLAN: CanvasPlan = {
  schemaVersion: 4,
  components: [
    {
      id: "plan-1",
      type: "plan",
      width: 1,
      html: "<h2>日落大片</h2><p>海滨的黄金时刻。记得带 85mm 镜头。</p>",
    },
    {
      id: "ref-1",
      type: "reference",
      width: 1,
      title: "造型参考",
      description: "",
      imageHeight: 135,
      showCaptions: false,
      images: [
        { id: "img-1", file: "references/0001.png", aspectRatio: 1.6 },
        { id: "img-2", file: "references/0002.png", aspectRatio: 0.67 },
        { id: "img-3", file: "references/0003.png", aspectRatio: 1.64 },
        { id: "img-4", file: "references/0004.png", aspectRatio: 0.65 },
      ],
    },
  ],
};

function createMemoryCanvasStores(): {
  repository: CanvasPlanRepository;
  imageStore: ReferenceImageStore;
} {
  let plan: CanvasPlan = structuredClone(SEEDED_V4_PLAN);
  let counter = Object.keys(SEEDED_IMAGE_DATA).length;
  return {
    repository: {
      async loadRawPlan(_projectPath: string) {
        return structuredClone(plan);
      },
      async saveRawPlan(_projectPath, nextPlan) {
        plan = structuredClone(nextPlan);
      },
    },
    imageStore: {
      async importImage(_projectPath: string, _sourcePath: string): Promise<ImportedImage> {
        counter += 1;
        return { file: `references/${String(counter).padStart(4, "0")}.png`, dataUrl: TINY_PNG };
      },
      async loadImage(_projectPath: string, _file: string) {
        return SEEDED_IMAGE_DATA[_file] ?? TINY_PNG;
      },
      async removeImage(_projectPath: string, _file: string) {
        return undefined;
      },
    },
  };
}

const memoryPicker: PlanImagePicker = {
  async pickImageFile(_title: string) {
    return "C:\\memory\\import.png";
  },
  async pickImageFiles(_title?: string) {
    return ["C:\\memory\\import1.png", "C:\\memory\\import2.png"];
  },
};

export function createBrowserCanvasPlanDependencies(): {
  service: CanvasPlanService;
  picker: PlanImagePicker;
} {
  const { repository, imageStore } = createMemoryCanvasStores();
  let counter = 0;
  return {
    service: createCanvasPlanService({
      repository,
      imageStore,
      createId: () => `canvas-${(counter += 1)}`,
      logger: planLogger,
    }),
    picker: memoryPicker,
  };
}

export const browserCanvasPlanDependencies = createBrowserCanvasPlanDependencies();
