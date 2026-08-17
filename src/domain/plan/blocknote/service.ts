import {
  BLOCKNOTE_PLAN_SCHEMA_VERSION,
  createEmptyProjectPlanV13,
  type ProjectPlanV13,
  validateProjectPlanV13,
} from "../canvas/blockDocument";
import {
  DEFAULT_IMAGE_HEIGHT,
  type ReferenceComponent,
  type ReferenceImage,
} from "../canvas/models";
import type { ReferenceImageStore } from "../ports";
import type { WorkspaceLogger } from "../../workspace/ports";
import type { BlockNotePlanRepository } from "./ports";

interface Dependencies {
  repository: BlockNotePlanRepository;
  imageStore: ReferenceImageStore;
  createId(): string;
  logger: WorkspaceLogger;
}

export type BlockNotePlanLoadResult =
  | { status: "missing"; plan: ProjectPlanV13 }
  | { status: "loaded"; plan: ProjectPlanV13 }
  | {
      status: "incompatible";
      foundSchemaVersion: number | null;
      requiredSchemaVersion: typeof BLOCKNOTE_PLAN_SCHEMA_VERSION;
    };

export interface BlockNotePlanService {
  loadPlan(projectPath: string, projectName: string): Promise<BlockNotePlanLoadResult>;
  savePlan(projectPath: string, plan: ProjectPlanV13): Promise<void>;
  loadImage(projectPath: string, file: string): Promise<string>;
  importImages(
    projectPath: string,
    plan: ProjectPlanV13,
    groupId: string,
    sourcePaths: string[],
  ): Promise<{
    plan: ProjectPlanV13;
    images: Array<{ image: ReferenceImage; dataUrl: string }>;
  }>;
  removeImage(
    projectPath: string,
    plan: ProjectPlanV13,
    groupId: string,
    imageId: string,
  ): Promise<ProjectPlanV13>;
  removeGroup(
    projectPath: string,
    plan: ProjectPlanV13,
    groupId: string,
  ): Promise<ProjectPlanV13>;
  purgeDetachedGroups(
    projectPath: string,
    activePlan: ProjectPlanV13,
    detachedGroups: ReferenceComponent[],
  ): Promise<void>;
}

function schemaVersionOf(raw: unknown): number | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "schemaVersion" in raw &&
    typeof raw.schemaVersion === "number" &&
    Number.isInteger(raw.schemaVersion)
  ) {
    return raw.schemaVersion;
  }
  return null;
}

export function createBlockNotePlanService({
  repository,
  imageStore,
  createId,
  logger,
}: Dependencies): BlockNotePlanService {
  let queue: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function referencesFile(plan: ProjectPlanV13, file: string): boolean {
    return plan.imageGroups.some((group) =>
      group.images.some((image) => image.file === file),
    );
  }

  function replaceGroup(
    plan: ProjectPlanV13,
    groupId: string,
    update: (group: ReferenceComponent) => ReferenceComponent,
  ): ProjectPlanV13 {
    let changed = false;
    const imageGroups = plan.imageGroups.map((group) => {
      if (group.id !== groupId) return group;
      const next = update(group);
      changed ||= next !== group;
      return next;
    });
    return changed ? { ...plan, imageGroups } : plan;
  }

  return {
    async loadPlan(projectPath, projectName) {
      const raw = await repository.loadRawPlan(projectPath);
      if (raw === null) {
        return {
          status: "missing",
          plan: createEmptyProjectPlanV13(projectName, { makeId: createId }),
        };
      }
      const foundSchemaVersion = schemaVersionOf(raw);
      if (foundSchemaVersion !== BLOCKNOTE_PLAN_SCHEMA_VERSION) {
        return {
          status: "incompatible",
          foundSchemaVersion,
          requiredSchemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
        };
      }
      return { status: "loaded", plan: validateProjectPlanV13(raw) };
    },
    async savePlan(projectPath, plan) {
      await repository.saveRawPlan(projectPath, validateProjectPlanV13(plan));
    },
    async loadImage(projectPath, file) {
      return imageStore.loadImage(projectPath, file);
    },
    importImages(projectPath, plan, groupId, sourcePaths) {
      return enqueue(async () => {
        const imported: Array<{ image: ReferenceImage; dataUrl: string }> = [];
        for (const sourcePath of sourcePaths) {
          const asset = await imageStore.importImage(projectPath, sourcePath);
          imported.push({
            dataUrl: asset.dataUrl,
            image: {
              id: createId(),
              file: asset.file,
              aspectRatio: 1,
              frameWidth: DEFAULT_IMAGE_HEIGHT,
              frameHeight: DEFAULT_IMAGE_HEIGHT,
            },
          });
        }
        const next = replaceGroup(plan, groupId, (group) => ({
          ...group,
          images: [...group.images, ...imported.map((entry) => entry.image)],
        }));
        await repository.saveRawPlan(projectPath, next);
        logger.info("BlockNote image-group images imported", {
          groupId,
          count: imported.length,
        });
        return { plan: next, images: imported };
      });
    },
    removeImage(projectPath, plan, groupId, imageId) {
      return enqueue(async () => {
        const target = plan.imageGroups
          .find((group) => group.id === groupId)
          ?.images.find((image) => image.id === imageId);
        const next = replaceGroup(plan, groupId, (group) => ({
          ...group,
          images: group.images.filter((image) => image.id !== imageId),
        }));
        await repository.saveRawPlan(projectPath, next);
        if (target && !referencesFile(next, target.file)) {
          await imageStore.removeImage(projectPath, target.file);
        }
        return next;
      });
    },
    removeGroup(projectPath, plan, groupId) {
      return enqueue(async () => {
        const target = plan.imageGroups.find((group) => group.id === groupId);
        const next = {
          ...plan,
          imageGroups: plan.imageGroups.filter((group) => group.id !== groupId),
        };
        await repository.saveRawPlan(projectPath, next);
        if (target) {
          for (const file of new Set(target.images.map((image) => image.file))) {
            if (!referencesFile(next, file)) {
              await imageStore.removeImage(projectPath, file);
            }
          }
        }
        return next;
      });
    },
    purgeDetachedGroups(projectPath, activePlan, detachedGroups) {
      return enqueue(async () => {
        const files = new Set(
          detachedGroups.flatMap((group) =>
            group.images.map((image) => image.file),
          ),
        );
        for (const file of files) {
          if (!referencesFile(activePlan, file)) {
            await imageStore.removeImage(projectPath, file);
          }
        }
      });
    },
  };
}
