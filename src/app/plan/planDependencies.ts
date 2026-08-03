import { createPlanService } from "../../domain/plan/service";
import { createCanvasPlanService } from "../../domain/plan/canvas/service";
import type { PlanDependencies } from "../../features/plan/ProjectPlanProvider";
import type { CanvasPlanDependencies } from "../../features/plan/ProjectCanvasProvider";
import { browserPlanDependencies, createBrowserCanvasPlanDependencies } from "../../infrastructure/plan/browserPlan";
import { planImagePicker } from "../../infrastructure/plan/planDialog";
import { tauriPlan } from "../../infrastructure/plan/tauriPlan";
import { planLogger } from "../../shared/logging/logger";
import { createPdfLibExporter } from "../../infrastructure/pdf/pdfLibExporter";
import { createCanvasPdfExporter } from "../../infrastructure/pdf/canvasPdfExporter";
import { loadNotoSansSc } from "../../infrastructure/pdf/fontAssets";
import { tauriPdfSaveTarget } from "../../infrastructure/pdf/tauriPdfSave";
import { browserPdfSaveTarget } from "../../infrastructure/pdf/browserPdfSave";

const pdfExporter = createPdfLibExporter(loadNotoSansSc);
const canvasPdfExporter = createCanvasPdfExporter(loadNotoSansSc);

function createProductionPlanDependencies(): PlanDependencies {
  return {
    service: createPlanService({
      repository: tauriPlan,
      imageStore: tauriPlan,
      createId: () => crypto.randomUUID(),
      logger: planLogger,
    }),
    picker: planImagePicker,
    logger: planLogger,
    exporter: pdfExporter,
    saver: tauriPdfSaveTarget,
  };
}

function createProductionCanvasPlanDependencies(): CanvasPlanDependencies {
  return {
    service: createCanvasPlanService({
      repository: tauriPlan,
      imageStore: tauriPlan,
      createId: () => crypto.randomUUID(),
      logger: planLogger,
    }),
    picker: planImagePicker,
    logger: planLogger,
    exporter: canvasPdfExporter,
    saver: tauriPdfSaveTarget,
  };
}

export function createPlanDependencies(): PlanDependencies {
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "memory") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The in-memory plan adapter is only available in end-to-end mode and must never run in a production build.",
      );
    }
    return {
      ...browserPlanDependencies,
      logger: planLogger,
      exporter: pdfExporter,
      saver: browserPdfSaveTarget,
    };
  }
  return createProductionPlanDependencies();
}

export function createCanvasPlanDependencies(): CanvasPlanDependencies {
  if (import.meta.env.VITE_WORKSPACE_ADAPTER === "memory") {
    if (import.meta.env.PROD) {
      throw new Error(
        "The in-memory canvas plan adapter is only available in end-to-end mode and must never run in a production build.",
      );
    }
    const browserDeps = createBrowserCanvasPlanDependencies();
    return {
      ...browserDeps,
      logger: planLogger,
      exporter: canvasPdfExporter,
      saver: browserPdfSaveTarget,
    };
  }
  return createProductionCanvasPlanDependencies();
}
