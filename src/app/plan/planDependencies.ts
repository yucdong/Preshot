import { createCanvasPlanService } from "../../domain/plan/canvas/service";
import type { CanvasPlanDependencies } from "../../features/plan/ProjectCanvasProvider";
import { createBrowserCanvasPlanDependencies } from "../../infrastructure/plan/browserPlan";
import { planImagePicker } from "../../infrastructure/plan/planDialog";
import { tauriPlan } from "../../infrastructure/plan/tauriPlan";
import { planLogger } from "../../shared/logging/logger";
import { createCanvasPdfExporter } from "../../infrastructure/pdf/canvasPdfExporter";
import { loadNotoSansSc } from "../../infrastructure/pdf/fontAssets";
import { tauriPdfSaveTarget } from "../../infrastructure/pdf/tauriPdfSave";
import { browserPdfSaveTarget } from "../../infrastructure/pdf/browserPdfSave";
import { tauriRevealTarget } from "../../infrastructure/pdf/revealPath";
import { browserRevealTarget } from "../../infrastructure/pdf/browserRevealPath";

const canvasPdfExporter = createCanvasPdfExporter(loadNotoSansSc);

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
    reveal: tauriRevealTarget,
  };
}

export function createPlanDependencies(): CanvasPlanDependencies {
  return createCanvasPlanDependencies();
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
      reveal: browserRevealTarget,
    };
  }
  return createProductionCanvasPlanDependencies();
}
