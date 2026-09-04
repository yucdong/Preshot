import {
  ARTIFACT_COLLECTION_IMAGE_LIMIT,
  ARTIFACT_IMAGE_LIMIT,
  BLOCKNOTE_PLAN_SCHEMA_VERSION,
  artifactCollectionsInPlan,
  createEmptyProjectPlanV15,
  mediaFilesInBlockDocument,
  migrateProjectPlanV13ToV14,
  migrateProjectPlanV14ToV15,
  type ArtifactRecord,
  type ImageCollection,
  type ProjectPlanV15,
  validateProjectPlanV15,
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
  | { status: "missing"; plan: ProjectPlanV15 }
  | { status: "loaded"; plan: ProjectPlanV15 }
  | { status: "migrated"; plan: ProjectPlanV15 }
  | {
      status: "incompatible";
      foundSchemaVersion: number | null;
      requiredSchemaVersion: typeof BLOCKNOTE_PLAN_SCHEMA_VERSION;
    };

export type BlockNotePlanProvider = () => ProjectPlanV15;

export interface BlockNotePlanService {
  loadPlan(projectPath: string, projectName: string): Promise<BlockNotePlanLoadResult>;
  savePlan(projectPath: string, plan: ProjectPlanV15): Promise<void>;
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
    plan: ProjectPlanV15;
    images: Array<{ image: ReferenceImage; dataUrl: string }>;
  }>;
  commitImageCrop(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
    imageId: string,
    crop: NormalizedImageCrop,
  ): Promise<{
    plan: ProjectPlanV15;
    image: ReferenceImage;
    dataUrl: string;
  }>;
  removeImage(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
    imageId: string,
  ): Promise<ProjectPlanV15>;
  removeGroup(
    projectPath: string,
    getLatestPlan: BlockNotePlanProvider,
    groupId: string,
  ): Promise<ProjectPlanV15>;
  purgeDetachedGroups(
    projectPath: string,
    activePlan: ProjectPlanV15,
    detachedGroups: ReferenceComponent[],
  ): Promise<void>;
  purgeDetachedMedia(
    projectPath: string,
    activePlan: ProjectPlanV15,
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

function mapArtifactCollections(
  artifact: ArtifactRecord,
  update: (collection: ImageCollection) => ImageCollection,
): ArtifactRecord {
  if (artifact.kind === "shootingLocation") {
    const gallery = update(artifact.gallery);
    return gallery === artifact.gallery ? artifact : { ...artifact, gallery };
  }
  if (artifact.kind === "modelCard") {
    const samples = update(artifact.samples);
    return samples === artifact.samples ? artifact : { ...artifact, samples };
  }
  if (artifact.kind === "clothing") {
    const mainGallery = update(artifact.mainGallery);
    const gallery = update(artifact.tryOn.gallery);
    if (
      mainGallery === artifact.mainGallery &&
      gallery === artifact.tryOn.gallery
    ) {
      return artifact;
    }
    return {
      ...artifact,
      mainGallery,
      tryOn: { ...artifact.tryOn, gallery },
    };
  }
  const gallery = update(artifact.gallery);
  return gallery === artifact.gallery ? artifact : { ...artifact, gallery };
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
  const committedArtifactCrops = new Map<string, Map<string, {
    revision: number;
    replacedFiles: Set<string>;
    image: ReferenceImage;
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
    plan: ProjectPlanV15,
    requestedRevision: number,
  ): ProjectPlanV15 {
    const crops = committedCrops.get(projectPath);
    const artifactCrops = committedArtifactCrops.get(projectPath);
    if (!crops && !artifactCrops) return plan;
    let changed = false;
    const applyCrop = (image: ReferenceImage) => {
      let next = image;
      const crop = crops?.get(next.file);
      if (crop && crop.revision > requestedRevision) {
        changed = true;
        next = withCropMetadata(next, crop.width, crop.height);
      }
      const artifactCrop = artifactCrops?.get(next.id);
      if (
        artifactCrop &&
        artifactCrop.revision > requestedRevision &&
        artifactCrop.replacedFiles.has(next.file)
      ) {
        changed = true;
        next = artifactCrop.image;
      }
      return next;
    };
    const imageGroups = plan.imageGroups.map((group) => {
      const images = group.images.map(applyCrop);
      const groupChanged = images.some((image, index) =>
        image !== group.images[index]
      );
      return groupChanged ? fitGroupToRows({ ...group, images }) : group;
    });
    const artifacts = plan.artifacts.map((artifact) =>
      mapArtifactCollections(artifact, (collection) => {
        const images = collection.images.map(applyCrop);
        return images.some((image, index) =>
            image !== collection.images[index])
          ? { ...collection, images }
          : collection;
      })
    );
    return changed ? { ...plan, imageGroups, artifacts } : plan;
  }

  function referencesFile(plan: ProjectPlanV15, file: string): boolean {
    return (
      plan.imageGroups.some((group) =>
        group.images.some((image) => image.file === file)
      ) ||
      artifactReferencesFile(plan, file)
    );
  }

  function artifactReferencesFile(
    plan: ProjectPlanV15,
    file: string,
  ): boolean {
    return artifactCollectionsInPlan(plan).some((collection) =>
      collection.images.some((image) => image.file === file)
    );
  }

  function imagesInCollection(
    plan: ProjectPlanV15,
    collectionId: string,
  ): ReferenceImage[] | undefined {
    return plan.imageGroups.find((group) => group.id === collectionId)?.images ??
      artifactCollectionsInPlan(plan).find((collection) =>
        collection.id === collectionId
      )?.images;
  }

  function replaceCollectionImages(
    plan: ProjectPlanV15,
    collectionId: string,
    update: (images: ReferenceImage[]) => ReferenceImage[],
  ): ProjectPlanV15 {
    let found = false;
    let changed = false;
    const imageGroups = plan.imageGroups.map((group) => {
      if (group.id !== collectionId) return group;
      found = true;
      const images = update(group.images);
      if (images === group.images) return group;
      changed = true;
      return fitGroupToRows({ ...group, images });
    });
    const artifacts = plan.artifacts.map((artifact) =>
      mapArtifactCollections(artifact, (collection) => {
        if (collection.id !== collectionId) return collection;
        found = true;
        const images = update(collection.images);
        if (images === collection.images) return collection;
        changed = true;
        return { ...collection, images };
      })
    );
    if (!found) {
      throw new Error(`image collection "${collectionId}" was not found`);
    }
    return changed ? { ...plan, imageGroups, artifacts } : plan;
  }

  function mapPlanImages(
    plan: ProjectPlanV15,
    update: (image: ReferenceImage) => ReferenceImage,
  ): ProjectPlanV15 {
    let changed = false;
    const imageGroups = plan.imageGroups.map((group) => {
      const images = group.images.map(update);
      if (!images.some((image, index) => image !== group.images[index])) {
        return group;
      }
      changed = true;
      return fitGroupToRows({ ...group, images });
    });
    const artifacts = plan.artifacts.map((artifact) =>
      mapArtifactCollections(artifact, (collection) => {
        const images = collection.images.map(update);
        if (!images.some((image, index) =>
          image !== collection.images[index]
        )) {
          return collection;
        }
        changed = true;
        return { ...collection, images };
      })
    );
    return changed ? { ...plan, imageGroups, artifacts } : plan;
  }

  function saveValidatedPlan(
    projectPath: string,
    plan: ProjectPlanV15,
  ): Promise<void> {
    return repository.saveRawPlan(projectPath, validateProjectPlanV15(plan));
  }

  async function rollbackCopiedCrop(
    projectPath: string,
    file: string,
    cause: unknown,
  ): Promise<never> {
    const message = cause instanceof Error ? cause.message : String(cause);
    let rollbackContext = "";
    try {
      await imageStore.removeImage(projectPath, file);
    } catch (rollbackError) {
      rollbackContext = `; copied-image rollback also failed: ${
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError)
      }`;
    }
    throw new Error(
      `Artifact image copy-on-write crop could not be committed: ${message}${rollbackContext}`,
      { cause },
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
          plan: createEmptyProjectPlanV15(projectName, { makeId: createId }),
        };
      }
      const foundSchemaVersion = schemaVersionOf(raw);
      if (foundSchemaVersion === 13) {
        const plan = migrateProjectPlanV14ToV15(
          migrateProjectPlanV13ToV14(raw),
        );
        await saveValidatedPlan(projectPath, plan);
        return { status: "migrated", plan };
      }
      if (foundSchemaVersion === 14) {
        const plan = migrateProjectPlanV14ToV15(raw);
        await saveValidatedPlan(projectPath, plan);
        return { status: "migrated", plan };
      }
      if (foundSchemaVersion !== BLOCKNOTE_PLAN_SCHEMA_VERSION) {
        return {
          status: "incompatible",
          foundSchemaVersion,
          requiredSchemaVersion: BLOCKNOTE_PLAN_SCHEMA_VERSION,
        };
      }
      return { status: "loaded", plan: validateProjectPlanV15(raw) };
    },
    savePlan(projectPath, plan) {
      const requestedRevision = revisionOf(projectPath);
      return enqueue(() =>
        saveValidatedPlan(
          projectPath,
          coalesceCommittedCrops(projectPath, plan, requestedRevision),
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
        let next: ProjectPlanV15;
        try {
          const initialPlan = getLatestPlan();
          const initialImages = imagesInCollection(initialPlan, groupId);
          if (!initialImages) {
            throw new Error(`image collection "${groupId}" was not found`);
          }
          const isArtifactCollection = artifactCollectionsInPlan(initialPlan).some(
            (collection) => collection.id === groupId,
          );
          if (
            isArtifactCollection &&
            initialImages.length + sourcePaths.length >
              ARTIFACT_COLLECTION_IMAGE_LIMIT
          ) {
            throw new Error(
              `image collection "${groupId}" exceeds the ${ARTIFACT_COLLECTION_IMAGE_LIMIT}-image limit`,
            );
          }
          const artifactImageCount = artifactCollectionsInPlan(initialPlan).reduce(
            (count, collection) => count + collection.images.length,
            0,
          );
          if (
            isArtifactCollection &&
            artifactImageCount + sourcePaths.length > ARTIFACT_IMAGE_LIMIT
          ) {
            throw new Error(
              `artifact images exceed the ${ARTIFACT_IMAGE_LIMIT}-image limit`,
            );
          }
          const existingImageIds = new Set([
            ...initialPlan.imageGroups.flatMap((group) =>
              group.images.map((image) => image.id)
            ),
            ...artifactCollectionsInPlan(initialPlan).flatMap((collection) =>
              collection.images.map((image) => image.id)
            ),
          ]);
          for (const sourcePath of sourcePaths) {
            const asset = await imageStore.importImage(projectPath, sourcePath);
            const imageId = createId();
            const entry = {
              dataUrl: asset.dataUrl,
              image: {
                id: imageId,
                file: asset.file,
                aspectRatio: 1,
                frameWidth: DEFAULT_IMAGE_HEIGHT,
                frameHeight: DEFAULT_IMAGE_HEIGHT,
              },
            };
            imported.push(entry);
            if (!imageId || existingImageIds.has(imageId)) {
              throw new Error(
                `generated image id "${imageId}" must be globally unique`,
              );
            }
            existingImageIds.add(imageId);
          }
          const plan = getLatestPlan();
          next = replaceCollectionImages(plan, groupId, (images) =>
            [...images, ...imported.map((entry) => entry.image)]
          );
          await saveValidatedPlan(projectPath, next);
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
        const target = imagesInCollection(currentPlan, groupId)
          ?.find((image) => image.id === imageId);
        if (!target) {
          throw new Error(`Unable to commit crop for reference image "${imageId}": image was not found`);
        }
        const bounds = cropBounds(target, crop);
        const requiresCopyOnWrite =
          artifactCollectionsInPlan(currentPlan).some(
            (collection) => collection.id === groupId,
          ) ||
          artifactReferencesFile(currentPlan, target.file);
        if (requiresCopyOnWrite) {
          const copyImageCrop = imageCropStore.copyImageCrop;
          if (!copyImageCrop) {
            throw new Error(
              `Unable to commit crop for shared image "${imageId}": copy-on-write crop storage is unavailable`,
            );
          }
          let copied;
          try {
            copied = await copyImageCrop(projectPath, {
              file: target.file,
              bounds,
            });
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : String(error);
            throw new Error(
              `Unable to commit crop for shared image "${target.file}": ${message}`,
              { cause: error },
            );
          }
          const copiedFileCanBeRemoved = (
            typeof copied.file === "string" &&
            copied.file !== target.file &&
            /^references\/[^/\\]+$/i.test(copied.file)
          );
          if (
            !copiedFileCanBeRemoved ||
            typeof copied.dataUrl !== "string" ||
            !copied.dataUrl ||
            !Number.isInteger(copied.width) ||
            !Number.isInteger(copied.height) ||
            copied.width <= 0 ||
            copied.height <= 0
          ) {
            const error = new Error(
              `Unable to commit crop for shared image "${target.file}": malformed copy result`,
            );
            if (copiedFileCanBeRemoved) {
              return rollbackCopiedCrop(projectPath, copied.file, error);
            }
            throw error;
          }

          const latestPlan = coalesceCommittedCrops(
            projectPath,
            getLatestPlan(),
            requestedRevision,
          );
          const latestTarget = imagesInCollection(latestPlan, groupId)
            ?.find((image) => image.id === imageId);
          if (!latestTarget || latestTarget.file !== target.file) {
            return rollbackCopiedCrop(
              projectPath,
              copied.file,
              new Error(
                `shared image "${imageId}" changed before copy-on-write commit`,
              ),
            );
          }
          const updatedTarget = {
            ...withCropMetadata(
              latestTarget,
              copied.width,
              copied.height,
            ),
            file: copied.file,
          };
          const next = replaceCollectionImages(
            latestPlan,
            groupId,
            (images) => images.map((image) =>
              image.id === imageId ? updatedTarget : image
            ),
          );
          try {
            await saveValidatedPlan(projectPath, next);
          } catch (error) {
            return rollbackCopiedCrop(projectPath, copied.file, error);
          }

          const revision = revisionOf(projectPath) + 1;
          projectRevisions.set(projectPath, revision);
          const artifactCrops = committedArtifactCrops.get(projectPath) ??
            new Map();
          const previous = artifactCrops.get(imageId);
          const replacedFiles = new Set(previous?.replacedFiles);
          replacedFiles.add(latestTarget.file);
          artifactCrops.set(imageId, {
            revision,
            replacedFiles,
            image: updatedTarget,
          });
          committedArtifactCrops.set(projectPath, artifactCrops);
          logger.info("BlockNote artifact image crop copied", {
            groupId,
            imageId,
            sourceFile: target.file,
            file: copied.file,
            width: copied.width,
            height: copied.height,
          });
          return {
            plan: next,
            image: updatedTarget,
            dataUrl: copied.dataUrl,
          };
        }

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
        const latestTarget = imagesInCollection(latestPlan, groupId)
          ?.find((image) => image.id === imageId);
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
        const next = mapPlanImages(latestPlan, (image) => {
          if (image.file !== target.file) return image;
          const updated = withCropMetadata(
            image,
            overwritten.width,
            overwritten.height,
          );
          if (image.id === imageId) {
            updatedTarget = updated;
          }
          return updated;
        });
        try {
          await saveValidatedPlan(projectPath, next);
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
        const target = imagesInCollection(plan, groupId)
          ?.find((image) => image.id === imageId);
        const next = replaceCollectionImages(
          plan,
          groupId,
          (images) => images.filter((image) => image.id !== imageId),
        );
        await saveValidatedPlan(projectPath, next);
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
        await saveValidatedPlan(projectPath, next);
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
        const copyCrops = committedArtifactCrops.get(projectPath);
        for (const crop of copyCrops?.values() ?? []) {
          files.add(crop.image.file);
          crop.replacedFiles.forEach((file) => files.add(file));
        }
        for (const file of files) {
          if (!referencesFile(activePlan, file)) {
            await imageStore.removeImage(projectPath, file);
          }
        }
        committedArtifactCrops.delete(projectPath);
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
