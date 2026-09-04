import { invoke } from "@tauri-apps/api/core";
import type {
  ImportedImage,
  ImportedPlanMedia,
  PlanMediaStore,
  ReferenceImageCropStore,
  ReferenceImageStore,
} from "../../domain/plan/ports";
import type { CanvasPlanRepository } from "../../domain/plan/canvas/ports";
import type { ProjectPlan as CanvasPlan } from "../../domain/plan/canvas/models";
import type { ProjectPlanV15 } from "../../domain/plan/canvas/blockDocument";
import type { BlockNotePlanRepository } from "../../domain/plan/blocknote/ports";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface Dependencies {
  invokeCommand?: InvokeCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function detail(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Malformed native response");
  }
  return value;
}

function validateImported(value: unknown): ImportedImage {
  if (!isRecord(value)) {
    throw new Error("Malformed native response");
  }
  return { file: requireString(value.file), dataUrl: requireString(value.dataUrl) };
}

function validateImportedMedia(value: unknown): ImportedPlanMedia {
  if (!isRecord(value)) {
    throw new Error("Malformed native response");
  }
  return {
    file: requireString(value.file),
    dataUrl: requireString(value.dataUrl),
    name: requireString(value.name),
    mimeType: requireString(value.mimeType),
  };
}

function requirePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Malformed native response");
  }
  return value;
}

export function createTauriPlan({ invokeCommand = invoke }: Dependencies = {}): ReferenceImageStore &
  ReferenceImageCropStore &
  PlanMediaStore &
  CanvasPlanRepository &
  BlockNotePlanRepository {
  return {
    async importImage(projectPath, sourcePath) {
      try {
        return validateImported(
          await invokeCommand("import_reference_image", { projectPath, sourcePath }),
        );
      } catch (error) {
        throw new Error(`Unable to import the reference image: ${detail(error)}`, { cause: error });
      }
    },
    async loadImage(projectPath, file) {
      try {
        return requireString(await invokeCommand("load_reference_image", { projectPath, file }));
      } catch (error) {
        throw new Error(`Unable to load the reference image: ${detail(error)}`, { cause: error });
      }
    },
    async removeImage(projectPath, file) {
      try {
        await invokeCommand("remove_reference_image", { projectPath, file });
      } catch (error) {
        throw new Error(`Unable to remove the reference image: ${detail(error)}`, { cause: error });
      }
    },
    async beginImageCrop(projectPath, input) {
      try {
        const value = await invokeCommand("crop_reference_image", {
          projectPath,
          file: input.file,
          bounds: input.bounds,
        });
        if (!isRecord(value)) {
          throw new Error("Malformed native response");
        }
        const transactionId = requireString(value.transactionId);
        const image = {
          file: requireString(value.file),
          dataUrl: requireString(value.dataUrl),
          width: requirePositiveInteger(value.width),
          height: requirePositiveInteger(value.height),
        };
        return {
          image,
          async commit() {
            try {
              await invokeCommand("commit_reference_image_crop", {
                projectPath,
                file: image.file,
                transactionId,
              });
            } catch (error) {
              throw new Error(`Unable to finalize the project reference image crop: ${detail(error)}`, {
                cause: error,
              });
            }
          },
          async rollback() {
            try {
              await invokeCommand("rollback_reference_image_crop", {
                projectPath,
                file: image.file,
                transactionId,
              });
            } catch (error) {
              throw new Error(`Unable to restore the project reference image: ${detail(error)}`, {
                cause: error,
              });
            }
          },
        };
      } catch (error) {
        throw new Error(`Unable to crop the project reference image: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async copyImageCrop(projectPath, input) {
      try {
        const value = await invokeCommand("copy_reference_image_crop", {
          projectPath,
          file: input.file,
          bounds: input.bounds,
        });
        if (!isRecord(value)) {
          throw new Error("Malformed native response");
        }
        return {
          file: requireString(value.file),
          dataUrl: requireString(value.dataUrl),
          width: requirePositiveInteger(value.width),
          height: requirePositiveInteger(value.height),
        };
      } catch (error) {
        throw new Error(
          `Unable to crop the project reference image to a copy: ${detail(error)}`,
          { cause: error },
        );
      }
    },
    async importMedia(projectPath, input) {
      try {
        return validateImportedMedia(await invokeCommand("import_plan_media", {
          projectPath,
          name: input.name,
          mimeType: input.mimeType,
          bytes: input.bytes,
        }));
      } catch (error) {
        throw new Error(`Unable to import plan media: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async loadMedia(projectPath, file) {
      try {
        return requireString(await invokeCommand("load_plan_media", {
          projectPath,
          file,
        }));
      } catch (error) {
        throw new Error(`Unable to load plan media: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async removeMedia(projectPath, file) {
      try {
        await invokeCommand("remove_plan_media", { projectPath, file });
      } catch (error) {
        throw new Error(`Unable to remove plan media: ${detail(error)}`, {
          cause: error,
        });
      }
    },
    async loadRawPlan(projectPath) {
      try {
        return (await invokeCommand("read_project_plan", { projectPath })) ?? null;
      } catch (error) {
        throw new Error(`Unable to read the project plan: ${detail(error)}`, { cause: error });
      }
    },
    async saveRawPlan(projectPath, plan: CanvasPlan | ProjectPlanV15) {
      try {
        await invokeCommand("save_project_plan", { projectPath, plan });
      } catch (error) {
        throw new Error(`Unable to save the project plan: ${detail(error)}`, { cause: error });
      }
    },
  };
}

export const tauriPlan = createTauriPlan();
