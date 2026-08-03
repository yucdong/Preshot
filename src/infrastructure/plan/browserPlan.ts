import { createPlanService, type PlanService } from "../../domain/plan/service";
import type { ProjectPlan } from "../../domain/plan/models";
import type { PlanImagePicker, PlanRepository, ReferenceImageStore } from "../../domain/plan/ports";
import { planLogger } from "../../shared/logging/logger";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SEEDED_PLAN: ProjectPlan = {
  photographyPlan:
    "<h2>日落大片</h2><p>海滨的黄金时刻。记得带 85mm 镜头。</p>",
  referenceGroups: [
    {
      id: "seed-group",
      title: "造型参考",
      description: "这组大片的氛围、光线与姿势参考。",
      columnsPerRow: 3,
      images: [
        { id: "seed-1", file: "references/0001.png" },
        { id: "seed-2", file: "references/0002.png" },
      ],
    },
  ],
};

function createMemoryStores(): { repository: PlanRepository; imageStore: ReferenceImageStore } {
  let plan: ProjectPlan = structuredClone(SEEDED_PLAN);
  let counter = 2;
  return {
    repository: {
      async loadPlan(_projectPath: string) {
        return structuredClone(plan);
      },
      async savePlan(_projectPath, nextPlan) {
        plan = structuredClone(nextPlan);
      },
    },
    imageStore: {
      async importImage(_projectPath: string, _sourcePath: string) {
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
};

export function createBrowserPlanDependencies(): { service: PlanService; picker: PlanImagePicker } {
  const { repository, imageStore } = createMemoryStores();
  let counter = 0;
  return {
    service: createPlanService({
      repository,
      imageStore,
      createId: () => `memory-${(counter += 1)}`,
      logger: planLogger,
    }),
    picker: memoryPicker,
  };
}

export const browserPlanDependencies = createBrowserPlanDependencies();
