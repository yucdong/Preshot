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
import { createBlockNoteDocxExporter } from "../../infrastructure/docx/blockNoteDocxExporter";
import { composePreshotDocxImageGroupInBrowser } from "../../infrastructure/docx/browserDocxImageGroupCompositor";
import { tauriDocxSaveTarget } from "../../infrastructure/docx/tauriDocxSave";
import { browserDocxSaveTarget } from "../../infrastructure/docx/browserDocxSave";
import { blockNoteLongImageExporter } from "../../infrastructure/longImage/BlockNoteLongImageExporter";
import { browserLongImageSaveTarget } from "../../infrastructure/longImage/browserLongImageSave";
import { tauriLongImageSaveTarget } from "../../infrastructure/longImage/tauriLongImageSave";

const blockNotePdfExporter = createReactPdfBlockNoteExporter();
const blockNoteDocxExporter = createBlockNoteDocxExporter({
  compositor: composePreshotDocxImageGroupInBrowser,
  onWarning(warning) {
    planLogger.warn("DOCX image group export warning", { ...warning });
  },
});

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
    docxExporter: blockNoteDocxExporter,
    longImageExporter: blockNoteLongImageExporter,
    picker: planImagePicker,
    screenCapture: tauriScreenCapture,
    logger: planLogger,
    saver: tauriPdfSaveTarget,
    docxSaver: tauriDocxSaveTarget,
    longImageSaver: tauriLongImageSaveTarget,
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
      docxExporter: blockNoteDocxExporter,
      longImageExporter: blockNoteLongImageExporter,
      picker: browserBlockNoteImagePicker,
      logger: planLogger,
      screenCapture: createBrowserScreenCapture(),
      saver: browserPdfSaveTarget,
      docxSaver: browserDocxSaveTarget,
      longImageSaver: browserLongImageSaveTarget,
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
      docxExporter: blockNoteDocxExporter,
      longImageExporter: blockNoteLongImageExporter,
      picker: browserBlockNoteImagePicker,
      logger: planLogger,
      screenCapture: createBrowserScreenCapture(),
      saver: browserPdfSaveTarget,
      docxSaver: browserDocxSaveTarget,
      longImageSaver: browserLongImageSaveTarget,
    };
  }
  return createProductionPlanDependencies();
}
