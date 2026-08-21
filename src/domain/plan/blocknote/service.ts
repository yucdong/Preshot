import {
  BLOCKNOTE_PLAN_SCHEMA_VERSION,
  createEmptyProjectPlanV14,
  mediaFilesInBlockDocument,
  migrateProjectPlanV13ToV14,
  type ProjectPlanV14,
  validateProjectPlanV14,
} from "../canvas/blockDocument";
import {
  DEFAULT_IMAGE_HEIGHT,
  MIN_COMPONENT_HEIGHT,
  type ReferenceComponent,
  type ReferenceImage,
} from "../canvas/models";
import { layoutDocumentImageGroupForWidth } from "../canvas/documentImageGroupLayout";
import type { NormalizedImageCrop } from "../canvas/imageView";
import type {
  PlanMediaStore,
  ReferenceImageCropTransaction,
  ReferenceImageCropStore,
  ReferenceImageStore,
} from "../ports";
import type { WorkspaceLogger } from "../../workspace/ports";
import type { BlockNotePlanRepository } from "./ports";

interface Dependencies {
  repository: BlockNotePlanRepository;
  imageStore: ReferenceImageStore;
  imageCropStore: ReferenceImageCropStore;
  mediaStore: PlanMediaStore;
  createId(): string;
  logger: WorkspaceLogger;
}

export type BlockNotePlanLoadResult =
  | { status: "missing"; plan: ProjectPlanV14 }
  | { status: "loaded"; plan: ProjectPlanV14 }
  | { status: "migrated"; plan: ProjectPlanV14 }
  | {
      status: "incompatible";
      foundSchemaVersion: number | null;
      requiredSchemaVersion: typeof BLOCKNOTE_PLAN_SCHEMA_VERSION;
    };

export type BlockNotePlanProvider = () => ProjectPlanV14;

export interface BlockNotePlanService {
  loadPlan(projectPath: string, projectName: string): Promise<BlockNotePlanLoadResult>;
  savePlan(projectPath: string, plan: ProjectPlanV14): Promise<void>;
  loadImage(projectPath: string, file: string): Promise<string>;
  importMedia(
    projectPath: string,
    input: {
      name: string;
      mimeType: string;
      bytes: number[];
    },
  ): ReturnType<PlanMediaStore["importMedia"]>;
  loadMedia(projectPath: string, file: string): Promise<string>;
  importImages(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
    sourcePaths: string[],
  ): Promise<{
    plan: ProjectPlanV14;
    images: Array<{ image: ReferenceImage; dataUrl: string }>;
  }>;
  commitImageCrop(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
    imageId: string,
    crop: NormalizedImageCrop,
  ): Promise<{
    plan: ProjectPlanV14;
    image: ReferenceImage;
    dataUrl: string;
  }>;
  removeImage(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
    imageId: string,
  ): Promise<ProjectPlanV14>;
  removeGroup(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
  ): Promise<ProjectPlanV14>;
  purgeDetachedGroups(
    projectPath: string,
    activePlan: ProjectPlanV14,
    detachedGroups: ReferenceComponent[],
  ): Promise<void>;
  purgeDetachedMedia(
    projectPath: string,
    activePlan: ProjectPlanV14,
    detachedFiles: string[],
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
  imageCropStore,
  mediaStore,
  createId,
  logger,
}: Dependencies): BlockNotePlanService {
  let queue: Promise<void> = Promise.resolve();
  const projectRevisions = new Map<string, number>();
  const committedCrops = new Map<string, Map<string, {
    revision: number;
    width: number;
    height: number;
  }>>();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function revisionOf(projectPath: string): number {
    return projectRevisions.get(projectPath) ?? 0;
  }

  function cleanupCommittedCrop(
    transaction: ReferenceImageCropTransaction,
    file: string,
  ): void {
    void Promise.resolve().then(() => transaction.commit()).catch((error) => {
      logger.warn("BlockNote reference image crop backup cleanup deferred", {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      void Promise.resolve().then(() => transaction.commit()).catch((retryError) => {
        logger.warn("BlockNote reference image crop backup cleanup remains pending", {
          file,
          error: retryError instanceof Error
            ? retryError.message
            : String(retryError),
        });
      });
    });
  }

  function withCropMetadata(
    image: ReferenceImage,
    width: number,
    height: number,
  ): ReferenceImage {
    const aspectRatio = width / height;
    const frameHeight = Number.isFinite(image.frameHeight) && image.frameHeight > 0
      ? image.frameHeight
      : DEFAULT_IMAGE_HEIGHT;
    return {
      ...image,
      aspectRatio,
      sourceWidth: width,
      sourceHeight: height,
      frameWidth: frameHeight * aspectRatio,
      frameHeight,
      frameOffsetX: 0,
      frameOffsetY: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    };
  }

  function fitGroupToRows(group: ReferenceComponent): ReferenceComponent {
    const height = Math.max(
      MIN_COMPONENT_HEIGHT,
      layoutDocumentImageGroupForWidth(group.images, group.width).height,
    );
    return height === group.height ? group : { ...group, height };
  }

  function coalesceCommittedCrops(
    projectPath: string,
    plan: ProjectPlanV14,
    requestedRevision: number,
  ): ProjectPlanV14 {
    const crops = committedCrops.get(projectPath);
    if (!crops) return plan;
    let changed = false;
    const imageGroups = plan.imageGroups.map((group) => {
      let groupChanged = false;
      const images = group.images.map((image) => {
        const crop = crops.get(image.file);
        if (!crop || crop.revision <= requestedRevision) return image;
        changed = true;
        groupChanged = true;
        return withCropMetadata(image, crop.width, crop.height);
      });
      return groupChanged ? fitGroupToRows({ ...group, images }) : group;
    });
    return changed ? { ...plan, imageGroups } : plan;
  }

  function referencesFile(plan: ProjectPlanV14, file: string): boolean {
    return plan.imageGroups.some((group) =>
      group.images.some((image) => image.file === file),
    );
  }

  async function rollbackImportedImages(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    imported: Array<{ image: ReferenceImage; dataUrl: string }>,
    cause: unknown,
  ): Promise<never> {
    const rollbackErrors: string[] = [];
    for (const file of new Set(imported.map(({ image }) => image.file))) {
      if (referencesFile(getLatestPlan(), file)) continue;
      try {
        await imageStore.removeImage(projectPath, file);
      } catch (error) {
        rollbackErrors.push(
          `${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    const rollbackContext = rollbackErrors.length > 0
      ? `; rollback also failed: ${rollbackErrors.join(", ")}`
      : "";
    throw new Error(
      `Unable to import reference images: ${message}${rollbackContext}`,
      { cause },
    );
  }

  function replaceGroup(
    plan: ProjectPlanV14,
    groupId: string,
    update: (group: ReferenceComponent) => ReferenceComponent,
  ): ProjectPlanV14 {
    let changed = false;
    const imageGroups = plan.imageGroups.map((group) => {
      if (group.id !== groupId) return group;
      const next = update(group);
      changed ||= next !== group;
      return next;
    });
    return changed ? { ...plan, imageGroups } : plan;
  }

  function cropBounds(
    image: ReferenceImage,
    crop: NormalizedImageCrop,
  ) {
    const values = [crop.x, crop.y, crop.width, crop.height];
    if (
      values.some((value) => !Number.isFinite(value)) ||
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.x + crop.width > 1 ||
      crop.y + crop.height > 1
    ) {
      throw new Error(`Unable to commit crop for reference image "${image.file}": crop bounds are invalid`);
    }
    if (
      typeof image.sourceWidth !== "number" ||
      typeof image.sourceHeight !== "number" ||
      !Number.isInteger(image.sourceWidth) ||
      !Number.isInteger(image.sourceHeight) ||
      image.sourceWidth <= 0 ||
      image.sourceHeight <= 0
    ) {
      throw new Error(`Unable to commit crop for reference image "${image.file}": source pixel dimensions are unavailable`);
    }
    const sourceWidth = image.sourceWidth;
    const sourceHeight = image.sourceHeight;
    const pairedEdges = (start: number, length: number, size: number) => {
      const first = Math.min(size - 1, Math.max(0, Math.round(start * size)));
      const last = Math.min(
        size,
        Math.max(first + 1, Math.round((start + length) * size)),
      );
      return [first, last] as const;
    };
    const [x, right] = pairedEdges(crop.x, crop.width, sourceWidth);
    const [y, bottom] = pairedEdges(crop.y, crop.height, sourceHeight);
    return { x, y, width: right - x, height: bottom - y };
  }

  return {
    async loadPlan(projectPath, projectName) {
      const raw = await repository.loadRawPlan(projectPath);
      if (raw === null) {
        return {
          status: "missing",
          plan: createEmptyProjectPlanV14(projectName, { makeId: createId }),
        };
      }
      const foundSchemaVersion = schemaVersionOf(raw);
      if (foundSchemaVersion === 13) {
        const plan = migrateProjectPlanV13ToV14(raw);
        await repository.saveRawPlan(projectPath, plan);
        return { status: "migrated", plan };
      }
      if (foundSchemaVersion !== BLOCKNOTE_PLAN_SCHEMA_VERSION) {
        return {
          status: "incompatible",
          foundSchemaVersion,
          requiredSchemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
        };
      }
      return { status: "loaded", plan: validateProjectPlanV14(raw) };
    },
    savePlan(projectPath, plan) {
      const requestedRevision = revisionOf(projectPath);
      return enqueue(() =>
        repository.saveRawPlan(
          projectPath,
          validateProjectPlanV14(
            coalesceCommittedCrops(projectPath, plan, requestedRevision),
          ),
        )
      );
    },
    async loadImage(projectPath, file) {
      return imageStore.loadImage(projectPath, file);
    },
    importMedia(projectPath, input) {
      return enqueue(() => mediaStore.importMedia(projectPath, input));
    },
    async loadMedia(projectPath, file) {
      return mediaStore.loadMedia(projectPath, file);
    },
    importImages(projectPath, getLatestPlan, groupId, sourcePaths) {
      return enqueue(async () => {
        const imported: Array<{ image: ReferenceImage; dataUrl: string }> = [];
        let next: ProjectPlanV14;
        try {
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
          const plan = getLatestPlan();
          if (!plan.imageGroups.some((group) => group.id === groupId)) {
            throw new Error(`image group "${groupId}" was not found`);
          }
          next = replaceGroup(plan, groupId, (group) =>
            fitGroupToRows({
              ...group,
              images: [...group.images, ...imported.map((entry) => entry.image)],
            })
          );
          await repository.saveRawPlan(projectPath, next);
        } catch (error) {
          return rollbackImportedImages(
            projectPath,
            getLatestPlan,
            imported,
            error,
          );
        }
        logger.info("BlockNote image-group images imported", {
          groupId,
          count: imported.length,
        });
        return { plan: next, images: imported };
      });
    },
    commitImageCrop(projectPath, getLatestPlan, groupId, imageId, crop) {
      const requestedRevision = revisionOf(projectPath);
      return enqueue(async () => {
        const currentPlan = coalesceCommittedCrops(
          projectPath,
          getLatestPlan(),
          requestedRevision,
        );
        const target = currentPlan.imageGroups
          .find((group) => group.id === groupId)
          ?.images.find((image) => image.id === imageId);
        if (!target) {
          throw new Error(`Unable to commit crop for reference image "${imageId}": image was not found`);
        }
        const bounds = cropBounds(target, crop);
        let transaction;
        try {
          transaction = await imageCropStore.beginImageCrop(projectPath, {
            file: target.file,
            bounds,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Unable to commit crop for reference image "${target.file}": ${message}`,
            { cause: error },
          );
        }
        const overwritten = transaction.image;
        if (
          overwritten.file !== target.file ||
          !Number.isInteger(overwritten.width) ||
          !Number.isInteger(overwritten.height) ||
          overwritten.width <= 0 ||
          overwritten.height <= 0
        ) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            throw new Error(
              `Unable to commit crop for reference image "${target.file}": malformed overwrite result; rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              { cause: rollbackError },
            );
          }
          throw new Error(`Unable to commit crop for reference image "${target.file}": malformed overwrite result`);
        }
        const latestPlan = coalesceCommittedCrops(
          projectPath,
          getLatestPlan(),
          requestedRevision,
        );
        const latestTarget = latestPlan.imageGroups
          .find((group) => group.id === groupId)
          ?.images.find((image) => image.id === imageId);
        if (!latestTarget || latestTarget.file !== target.file) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            throw new Error(
              `Unable to commit crop for reference image "${target.file}": image changed before commit; rollback also failed: ${
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError)
              }`,
              { cause: rollbackError },
            );
          }
          throw new Error(
            `Unable to commit crop for reference image "${target.file}": image changed before commit`,
          );
        }
        let updatedTarget: ReferenceImage | undefined;
        const imageGroups = latestPlan.imageGroups.map((group) => {
          let groupChanged = false;
          const images = group.images.map((image) => {
            if (image.file !== target.file) return image;
            groupChanged = true;
            const updated = withCropMetadata(
              image,
              overwritten.width,
              overwritten.height,
            );
            if (image.id === imageId && group.id === groupId) {
              updatedTarget = updated;
            }
            return updated;
          });
          return groupChanged
            ? fitGroupToRows({ ...group, images })
            : group;
        });
        const next = { ...latestPlan, imageGroups };
        try {
          await repository.saveRawPlan(projectPath, next);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          let rollbackContext = "";
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            rollbackContext = `; rollback also failed: ${
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError)
            }`;
          }
          throw new Error(
            `Reference image "${target.file}" crop metadata could not be saved: ${message}${rollbackContext}`,
            { cause: error },
          );
        }
        const revision = revisionOf(projectPath) + 1;
        projectRevisions.set(projectPath, revision);
        const crops = committedCrops.get(projectPath) ?? new Map();
        crops.set(target.file, {
          revision,
          width: overwritten.width,
          height: overwritten.height,
        });
        committedCrops.set(projectPath, crops);
        cleanupCommittedCrop(transaction, target.file);
        logger.info("BlockNote reference image crop committed", {
          groupId,
          imageId,
          file: target.file,
          width: overwritten.width,
          height: overwritten.height,
        });
        return {
          plan: next,
          image: updatedTarget ?? target,
          dataUrl: overwritten.dataUrl,
        };
      });
    },
    removeImage(projectPath, getLatestPlan, groupId, imageId) {
      return enqueue(async () => {
        const plan = getLatestPlan();
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
    removeGroup(projectPath, getLatestPlan, groupId) {
      return enqueue(async () => {
        const plan = getLatestPlan();
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
    purgeDetachedMedia(projectPath, activePlan, detachedFiles) {
      return enqueue(async () => {
        const activeFiles = new Set(
          mediaFilesInBlockDocument(activePlan.document),
        );
        for (const file of new Set(detachedFiles)) {
          if (!activeFiles.has(file)) {
            await mediaStore.removeMedia(projectPath, file);
          }
        }
      });
    },
  };
}
