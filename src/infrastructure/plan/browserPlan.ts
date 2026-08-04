import type { ImportedImage, PlanImagePicker, ReferenceImageStore } from "../../domain/plan/ports";
import { planLogger } from "../../shared/logging/logger";
import { createCanvasPlanService, type CanvasPlanService } from "../../domain/plan/canvas/service";
import type { CanvasPlanRepository } from "../../domain/plan/canvas/ports";
import type { ProjectPlan as CanvasPlan } from "../../domain/plan/canvas/models";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SEEDED_V3_PLAN: CanvasPlan = {
  schemaVersion: 3,
  components: [
    {
      id: "plan-1",
      type: "plan",
      width: 1,
      height: 220,
      html: "<h2>日落大片</h2><p>海滨的黄金时刻。记得带 85mm 镜头。</p>",
    },
    {
      id: "ref-1",
      type: "reference",
      width: 1,
      height: 320,
      title: "造型参考",
      description: "",
      imageHeight: 180,
      showCaptions: false,
      images: [
        { id: "img-1", file: "references/0001.png", aspectRatio: 1 },
        { id: "img-2", file: "references/0002.png", aspectRatio: 1 },
      ],
    },
  ],
};

function createMemoryCanvasStores(): {
  repository: CanvasPlanRepository;
  imageStore: ReferenceImageStore;
} {
  let plan: CanvasPlan = structuredClone(SEEDED_V3_PLAN);
  let counter = 2;
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
        return TINY_PNG;
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
