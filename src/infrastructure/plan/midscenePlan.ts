import { createCanvasPlanService } from "../../domain/plan/canvas/service";
import { EMPTY_PLAN, type ProjectPlan } from "../../domain/plan/canvas/models";
import type { CanvasPlanRepository } from "../../domain/plan/canvas/ports";
import type { ImportedImage, PlanImagePicker, ReferenceImageStore } from "../../domain/plan/ports";
import { planLogger } from "../../shared/logging/logger";

const PLAN_KEY_PREFIX = "preshot.midscene.plan.";
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function planKey(projectPath: string) {
  return `${PLAN_KEY_PREFIX}${encodeURIComponent(projectPath)}`;
}

function createRepository(): CanvasPlanRepository {
  return {
    async loadRawPlan(projectPath) {
      const stored = window.localStorage.getItem(planKey(projectPath));
      return stored ? JSON.parse(stored) as ProjectPlan : structuredClone(EMPTY_PLAN);
    },
    async saveRawPlan(projectPath, plan) {
      window.localStorage.setItem(planKey(projectPath), JSON.stringify(plan));
    },
  };
}

function createImageStore(): ReferenceImageStore {
  let counter = 0;
  return {
    async importImage(_projectPath, _sourcePath): Promise<ImportedImage> {
      counter += 1;
      return { file: `references/midscene-${counter}.png`, dataUrl: TINY_PNG };
    },
    async loadImage() {
      return TINY_PNG;
    },
    async removeImage() {
      return undefined;
    },
  };
}

const picker: PlanImagePicker = {
  async pickImageFile() {
    return "C:\\Preshot Midscene Runs\\fixture.png";
  },
  async pickImageFiles() {
    return ["C:\\Preshot Midscene Runs\\fixture.png"];
  },
};

export function createMidsceneCanvasPlanDependencies() {
  return {
    service: createCanvasPlanService({
      repository: createRepository(),
      imageStore: createImageStore(),
      createId: () => `midscene-canvas-${crypto.randomUUID()}`,
      logger: planLogger,
    }),
    picker,
  };
}
