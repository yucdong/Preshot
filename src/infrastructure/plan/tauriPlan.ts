import { invoke } from "@tauri-apps/api/core";
import type { ImportedImage, ProjectPlan, ReferenceGroup } from "../../domain/plan/models";
import type { PlanRepository, ReferenceImageStore } from "../../domain/plan/ports";

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

function validateGroup(value: unknown): ReferenceGroup {
  if (!isRecord(value) || !Array.isArray(value.images) || typeof value.columnsPerRow !== "number") {
    throw new Error("Malformed native response");
  }
  return {
    id: requireString(value.id),
    title: typeof value.title === "string" ? value.title : "",
    columnsPerRow: value.columnsPerRow,
    images: value.images.map((image) => {
      if (!isRecord(image)) {
        throw new Error("Malformed native response");
      }
      return { id: requireString(image.id), file: requireString(image.file) };
    }),
  };
}

function validatePlan(value: unknown): ProjectPlan {
  if (!isRecord(value) || !Array.isArray(value.referenceGroups)) {
    throw new Error("Malformed native response");
  }
  return { referenceGroups: value.referenceGroups.map(validateGroup) };
}

function validateImported(value: unknown): ImportedImage {
  if (!isRecord(value)) {
    throw new Error("Malformed native response");
  }
  return { file: requireString(value.file), dataUrl: requireString(value.dataUrl) };
}

export function createTauriPlan({ invokeCommand = invoke }: Dependencies = {}): PlanRepository &
  ReferenceImageStore {
  return {
    async loadPlan(projectPath) {
      try {
        return validatePlan(await invokeCommand("read_project_plan", { projectPath }));
      } catch (error) {
        throw new Error(`Unable to read the project plan: ${detail(error)}`, { cause: error });
      }
    },
    async savePlan(projectPath, plan) {
      try {
        await invokeCommand("save_project_plan", { projectPath, plan });
      } catch (error) {
        throw new Error(`Unable to save the project plan: ${detail(error)}`, { cause: error });
      }
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
        await invokeCommand("remove_reference_image", { projectPath, file });
      } catch (error) {
        throw new Error(`Unable to remove the reference image: ${detail(error)}`, { cause: error });
      }
    },
  };
}

export const tauriPlan = createTauriPlan();
