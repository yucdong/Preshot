import type { PlanDependencies } from "../../features/plan/blocknote/dependencies";
import { planImagePicker } from "../../infrastructure/plan/planDialog";
import { tauriPlan } from "../../infrastructure/plan/tauriPlan";
import { planLogger } from "../../shared/logging/logger";
import { tauriPdfSaveTarget } from "../../infrastructure/pdf/tauriPdfSave";
import { browserPdfSaveTarget } from "../../infrastructure/pdf/browserPdfSave";
import { tauriScreenCapture } from "../../infrastructure/plan/screenCapture";
import { createBrowserScreenCapture } from "../../infrastructure/plan/browserScreenCapture";
import { createBlockNotePlanService } from "../../domain/plan/blocknote/service";
import {
  browserBlockNoteImageStore,
  browserBlockNoteMediaStore,
  browserBlockNoteImagePicker,
  browserBlockNotePlanRepository,
} from "../../infrastructure/plan/browserBlockNotePlan";
import { createReactPdfBlockNoteExporter } from "../../infrastructure/pdf/reactPdfBlockNoteExporter";

const blockNotePdfExporter = createReactPdfBlockNoteExporter();

function createProductionPlanDependencies(): PlanDependencies {
  return {
    service: createBlockNotePlanService({
      repository: tauriPlan,
      imageStore: tauriPlan,
      imageCropStore: tauriPlan,
      mediaStore: tauriPlan,
      createId: () => crypto.randomUUID(),
      logger: planLogger,
    }),
    exporter: blockNotePdfExporter,
    picker: planImagePicker,
    screenCapture: tauriScreenCapture,
    logger: planLogger,
    saver: tauriPdfSaveTarget,
  };
}

export function createPlanDependencies(): PlanDependencies {
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "midscene") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The Midscene canvas plan adapter is only available in test mode and must never run in a production build.",
      );
    }
    return {
      service: createBlockNotePlanService({
        repository: browserBlockNotePlanRepository,
        imageStore: browserBlockNoteImageStore,
        imageCropStore: browserBlockNoteImageStore,
        mediaStore: browserBlockNoteMediaStore,
        createId: () => crypto.randomUUID(),
        logger: planLogger,
      }),
      exporter: blockNotePdfExporter,
      picker: browserBlockNoteImagePicker,
      logger: planLogger,
      screenCapture: createBrowserScreenCapture(),
      saver: browserPdfSaveTarget,
    };
  }
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "memory") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The in-memory canvas plan adapter is only available in end-to-end mode and must never run in a production build.",
      );
    }
    return {
      service: createBlockNotePlanService({
        repository: browserBlockNotePlanRepository,
        imageStore: browserBlockNoteImageStore,
        imageCropStore: browserBlockNoteImageStore,
        mediaStore: browserBlockNoteMediaStore,
        createId: () => crypto.randomUUID(),
        logger: planLogger,
      }),
      exporter: blockNotePdfExporter,
      picker: browserBlockNoteImagePicker,
      logger: planLogger,
      screenCapture: createBrowserScreenCapture(),
      saver: browserPdfSaveTarget,
    };
  }
  return createProductionPlanDependencies();
}
