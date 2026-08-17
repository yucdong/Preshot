import type { WorkspaceLogger } from "../../../domain/workspace/ports";
import type { PdfSaveTarget } from "../../../domain/plan/canvas/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { PlanImagePicker, ScreenCapture } from "../../../domain/plan/ports";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";

export interface PlanDependencies {
  service: BlockNotePlanService;
  exporter: BlockNotePdfExporter;
  picker: PlanImagePicker;
  saver: PdfSaveTarget;
  screenCapture?: ScreenCapture;
  logger: WorkspaceLogger;
}
