import { DEFAULT_COLUMNS, type ProjectPlan, type ReferenceImage } from "./models";
import {
  addGroup as addGroupToPlan,
  addImage as addImageToPlan,
  createGroup,
  deleteGroup as deleteGroupFromPlan,
  findGroup,
  removeImage as removeImageFromPlan,
  renameGroup as renameGroupInPlan,
  setColumns as setColumnsInPlan,
} from "./plan";
import type { PlanRepository, ReferenceImageStore } from "./ports";
import type { WorkspaceLogger } from "../workspace/ports";

interface Dependencies {
  repository: PlanRepository;
  imageStore: ReferenceImageStore;
  createId: () => string;
  logger: WorkspaceLogger;
}

export interface ImportImageResult {
  plan: ProjectPlan;
  image: ReferenceImage;
  dataUrl: string;
}

export interface PlanService {
  loadPlan(projectPath: string): Promise<ProjectPlan>;
  loadImage(projectPath: string, file: string): Promise<string>;
  addGroup(projectPath: string, plan: ProjectPlan, title: string): Promise<ProjectPlan>;
  renameGroup(projectPath: string, plan: ProjectPlan, groupId: string, title: string): Promise<ProjectPlan>;
  deleteGroup(projectPath: string, plan: ProjectPlan, groupId: string): Promise<ProjectPlan>;
  setColumns(projectPath: string, plan: ProjectPlan, groupId: string, columns: number): Promise<ProjectPlan>;
  importImage(projectPath: string, plan: ProjectPlan, groupId: string, sourcePath: string): Promise<ImportImageResult>;
  removeImage(projectPath: string, plan: ProjectPlan, groupId: string, imageId: string): Promise<ProjectPlan>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextualError(context: string, error: unknown): Error {
  return new Error(`${context}: ${message(error)}`, { cause: error });
}

export function createPlanService({
  repository,
  imageStore,
  createId,
  logger,
}: Dependencies): PlanService {
  let queue: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function persist(projectPath: string, plan: ProjectPlan): Promise<void> {
    try {
      await repository.savePlan(projectPath, plan);
    } catch (error) {
      throw contextualError("Unable to save the project plan", error);
    }
  }

  return {
    loadPlan(projectPath) {
      return enqueue(async () => {
        try {
          return await repository.loadPlan(projectPath);
        } catch (error) {
          throw contextualError("Unable to load the project plan", error);
        }
      });
    },
    async loadImage(projectPath, file) {
      try {
        return await imageStore.loadImage(projectPath, file);
      } catch (error) {
        throw contextualError("Unable to load a reference image", error);
      }
    },
    addGroup(projectPath, plan, title) {
      return enqueue(async () => {
        const next = addGroupToPlan(plan, createGroup(createId(), title, DEFAULT_COLUMNS));
        await persist(projectPath, next);
        logger.info("Reference group added", { groups: next.referenceGroups.length });
        return next;
      });
    },
    renameGroup(projectPath, plan, groupId, title) {
      return enqueue(async () => {
        const next = renameGroupInPlan(plan, groupId, title);
        await persist(projectPath, next);
        return next;
      });
    },
    deleteGroup(projectPath, plan, groupId) {
      return enqueue(async () => {
        const group = findGroup(plan, groupId);
        const next = deleteGroupFromPlan(plan, groupId);
        await persist(projectPath, next);
        for (const image of group?.images ?? []) {
          try {
            await imageStore.removeImage(projectPath, image.file);
          } catch (error) {
            logger.warn("Unable to delete a reference image file", { file: image.file, reason: message(error) });
          }
        }
        logger.info("Reference group deleted", { groupId });
        return next;
      });
    },
    setColumns(projectPath, plan, groupId, columns) {
      return enqueue(async () => {
        const next = setColumnsInPlan(plan, groupId, columns);
        await persist(projectPath, next);
        return next;
      });
    },
    importImage(projectPath, plan, groupId, sourcePath) {
      return enqueue(async () => {
        let imported;
        try {
          imported = await imageStore.importImage(projectPath, sourcePath);
        } catch (error) {
          throw contextualError("Unable to import the reference image", error);
        }
        const image: ReferenceImage = { id: createId(), file: imported.file };
        const next = addImageToPlan(plan, groupId, image);
        await persist(projectPath, next);
        logger.info("Reference image imported", { groupId, file: image.file });
        return { plan: next, image, dataUrl: imported.dataUrl };
      });
    },
    removeImage(projectPath, plan, groupId, imageId) {
      return enqueue(async () => {
        const target = findGroup(plan, groupId)?.images.find((image) => image.id === imageId);
        const next = removeImageFromPlan(plan, groupId, imageId);
        await persist(projectPath, next);
        if (target) {
          try {
            await imageStore.removeImage(projectPath, target.file);
          } catch (error) {
            logger.warn("Unable to delete a reference image file", { file: target.file, reason: message(error) });
          }
        }
        logger.info("Reference image removed", { groupId, imageId });
        return next;
      });
    },
  };
}
