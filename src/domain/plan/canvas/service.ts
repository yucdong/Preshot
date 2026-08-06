import type { ReferenceImageStore } from "../ports";
import type { WorkspaceLogger } from "../../workspace/ports";
import type { CanvasPlanRepository } from "./ports";
import type { ProjectPlan, ReferenceComponent, ReferenceImage } from "./models";
import { migratePlan } from "./migrate";
import { addReferenceImage, addReferenceImages, removeComponent, removeReferenceImage } from "./plan";

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

export interface ImportImagesResult {
  plan: ProjectPlan;
  images: { image: ReferenceImage; dataUrl: string }[];
}

export type CanvasPlanLoadResult =
  | { status: "missing" }
  | { status: "loaded"; plan: ProjectPlan };

export interface CanvasPlanService {
  loadPlan(projectPath: string, projectName: string): Promise<CanvasPlanLoadResult>;
  savePlan(projectPath: string, plan: ProjectPlan): Promise<void>;
  loadImage(projectPath: string, file: string): Promise<string>;
  importImage(
    projectPath: string,
    plan: ProjectPlan,
    componentId: string,
    sourcePath: string,
  ): Promise<ImportImageResult>;
  importImages(
    projectPath: string,
    plan: ProjectPlan,
    componentId: string,
    sourcePaths: string[],
  ): Promise<ImportImagesResult>;
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

function referencesImageFile(plan: ProjectPlan, file: string): boolean {
  return plan.components.some(
    (component) =>
      component.type === "reference" &&
      component.images.some((image) => image.file === file),
  );
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
    loadPlan(projectPath, projectName) {
      return enqueue(async () => {
        try {
          const raw = await repository.loadRawPlan(projectPath);
          if (raw == null) {
            return { status: "missing" };
          }
          return {
            status: "loaded",
            plan: migratePlan(raw, { projectName, makeId: () => createId() }),
          };
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
        const image: ReferenceImage = { id: createId(), file: imported.file, aspectRatio: 1 };
        const next = addReferenceImage(plan, { componentId, image });
        await persist(projectPath, next);
        logger.info("Reference image imported", { componentId, file: image.file });
        return { plan: next, image, dataUrl: imported.dataUrl };
      });
    },
    importImages(projectPath, plan, componentId, sourcePaths) {
      return enqueue(async () => {
        const images: { image: ReferenceImage; dataUrl: string }[] = [];
        for (const sourcePath of sourcePaths) {
          let imported;
          try {
            imported = await imageStore.importImage(projectPath, sourcePath);
          } catch (error) {
            throw contextualError("Unable to import a reference image", error);
          }
          const image: ReferenceImage = { id: createId(), file: imported.file, aspectRatio: 1 };
          images.push({ image, dataUrl: imported.dataUrl });
        }
        const next = addReferenceImages(plan, {
          componentId,
          images: images.map((item) => item.image),
        });
        await persist(projectPath, next);
        logger.info("Reference images imported", { componentId, count: images.length });
        return { plan: next, images };
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
        if (target && !referencesImageFile(next, target.file)) {
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
          const removedFiles = new Set(component.images.map((image) => image.file));
          for (const file of removedFiles) {
            if (referencesImageFile(next, file)) {
              continue;
            }
            try {
              await imageStore.removeImage(projectPath, file);
            } catch (error) {
              logger.warn("Unable to delete a reference image file", {
                file,
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
