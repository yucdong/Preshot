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
import type { ImagePasteRepository } from "../../domain/clipboard/projectImagePaste";

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
  BlockNotePlanRepository & ImagePasteRepository {
  return {
    async isImageRetainedForHistory(projectPath, file) {
      try {
        const value = await invokeCommand("is_reference_image_retained_for_history", { projectPath, file });
        if (typeof value !== "boolean") throw new Error("Malformed image history retention result");
        return value;
      } catch (error) { throw new Error(`无法确认图片历史保留状态：${detail(error)}`, { cause: error }); }
    },
    async prepareImagePaste(input) {
      try {
        const value = await invokeCommand("prepare_image_paste", input);
        if (!isRecord(value)) throw new Error("Malformed image paste receipt");
        const operationId = requireString(value.operationId);
        const file = requireString(value.file);
        if (operationId !== input.operationId ||
            !(input.destination === "references" ? /^references\/[0-9]{4,}\.(jpg|png)$/ : /^media\/[^/\\]+\.(jpg|jpeg|png|gif|webp)$/).test(file)) {
          throw new Error("Image paste receipt does not match the destination");
        }
        return { operationId, file, name: requireString(value.name), mimeType: requireString(value.mimeType) };
      } catch (error) {
        throw new Error(`无法准备图片粘贴：${detail(error)}`, { cause: error });
      }
    },
    async commitImagePaste(input) {
      try { await invokeCommand("commit_image_paste", input); }
      catch (error) { throw new Error(`无法提交图片粘贴：${detail(error)}`, { cause: error }); }
    },
    async getImagePasteStatus(projectPath, operationId) {
      try {
        const value = await invokeCommand("get_image_paste_status", { projectPath, operationId });
        if (!isRecord(value) || !["prepared", "committed", "aborted", "missing"].includes(String(value.status))) {
          throw new Error("Malformed image paste status");
        }
        const status = value.status;
        if (status !== "prepared" && status !== "committed" && status !== "aborted" && status !== "missing") {
          throw new Error("Invalid image paste status");
        }
        return status;
      } catch (error) { throw new Error(`无法确认图片粘贴结果：${detail(error)}`, { cause: error }); }
    },
    async abortImagePaste(projectPath, operationId) {
      try { await invokeCommand("abort_image_paste", { projectPath, operationId }); }
      catch (error) { throw new Error(`无法清理未提交的图片粘贴：${detail(error)}`, { cause: error }); }
    },
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
        const status = await invokeCommand("remove_reference_image", { projectPath, file });
        if (status !== "removed" && status !== "retainedForMaterialHistory") {
          throw new Error("Malformed native response");
        }
        return status;
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
