import type { ReferenceImageStore } from "../ports";
import type { WorkspaceLogger } from "../../workspace/ports";
import type { CanvasPlanRepository } from "./ports";
import type { ProjectPlan, ReferenceComponent, ReferenceImage } from "./models";
import { EMPTY_PLAN } from "./models";
import { migratePlan } from "./migrate";
import { addReferenceImage, removeComponent, removeReferenceImage } from "./plan";

interface Dependencies {
  repository: CanvasPlanRepository;
  imageStore: ReferenceImageStore;
  createId: () => string;
  logger: WorkspaceLogger;
}

export interface ImportImageResult {
  plan: ProjectPlan;
  image: ReferenceImage;
  dataUrl: string;
}

export interface CanvasPlanService {
  loadPlan(projectPath: string): Promise<ProjectPlan>;
  savePlan(projectPath: string, plan: ProjectPlan): Promise<void>;
  loadImage(projectPath: string, file: string): Promise<string>;
  importImage(
    projectPath: string,
    plan: ProjectPlan,
    componentId: string,
    sourcePath: string,
  ): Promise<ImportImageResult>;
  removeImage(
    projectPath: string,
    plan: ProjectPlan,
    componentId: string,
    imageId: string,
  ): Promise<ProjectPlan>;
  removeComponent(projectPath: string, plan: ProjectPlan, componentId: string): Promise<ProjectPlan>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextualError(context: string, error: unknown): Error {
  return new Error(`${context}: ${message(error)}`, { cause: error });
}

export function createCanvasPlanService({
  repository,
  imageStore,
  createId,
  logger,
}: Dependencies): CanvasPlanService {
  let queue: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function persist(projectPath: string, plan: ProjectPlan): Promise<void> {
    try {
      await repository.saveRawPlan(projectPath, plan);
    } catch (error) {
      throw contextualError("Unable to save the project plan", error);
    }
  }

  return {
    loadPlan(projectPath) {
      return enqueue(async () => {
        try {
          const raw = await repository.loadRawPlan(projectPath);
          if (raw == null) {
            return EMPTY_PLAN;
          }
          return migratePlan(raw);
        } catch (error) {
          throw contextualError("Unable to load the project plan", error);
        }
      });
    },
    savePlan(projectPath, plan) {
      return enqueue(() => persist(projectPath, plan));
    },
    async loadImage(projectPath, file) {
      try {
        return await imageStore.loadImage(projectPath, file);
      } catch (error) {
        throw contextualError("Unable to load a reference image", error);
      }
    },
    importImage(projectPath, plan, componentId, sourcePath) {
      return enqueue(async () => {
        let imported;
        try {
          imported = await imageStore.importImage(projectPath, sourcePath);
        } catch (error) {
          throw contextualError("Unable to import the reference image", error);
        }
        const image: ReferenceImage = { id: createId(), file: imported.file };
        const next = addReferenceImage(plan, { componentId, image });
        await persist(projectPath, next);
        logger.info("Reference image imported", { componentId, file: image.file });
        return { plan: next, image, dataUrl: imported.dataUrl };
      });
    },
    removeImage(projectPath, plan, componentId, imageId) {
      return enqueue(async () => {
        const component = plan.components.find(
          (c): c is ReferenceComponent => c.type === "reference" && c.id === componentId,
        );
        const target = component?.images.find((image) => image.id === imageId);
        const next = removeReferenceImage(plan, { componentId, imageId });
        await persist(projectPath, next);
        if (target) {
          try {
            await imageStore.removeImage(projectPath, target.file);
          } catch (error) {
            logger.warn("Unable to delete a reference image file", {
              file: target.file,
              reason: message(error),
            });
          }
        }
        logger.info("Reference image removed", { componentId, imageId });
        return next;
      });
    },
    removeComponent(projectPath, plan, componentId) {
      return enqueue(async () => {
        const component = plan.components.find(
          (c): c is ReferenceComponent => c.type === "reference" && c.id === componentId,
        );
        const next = removeComponent(plan, componentId);
        await persist(projectPath, next);
        if (component) {
          for (const image of component.images) {
            try {
              await imageStore.removeImage(projectPath, image.file);
            } catch (error) {
              logger.warn("Unable to delete a reference image file", {
                file: image.file,
                reason: message(error),
              });
            }
          }
        }
        logger.info("Component removed", { componentId });
        return next;
      });
    },
  };
}
