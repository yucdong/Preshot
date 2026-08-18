import type { WorkspaceLogger } from "../../../domain/workspace/ports";
import type {
  DocxSaveTarget,
  PdfSaveTarget,
} from "../../../domain/plan/canvas/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { PlanImagePicker, ScreenCapture } from "../../../domain/plan/ports";
import type { BlockNoteDocxExporter } from "../../../infrastructure/docx/blockNoteDocxExporter";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";

export interface PlanDependencies {
  service: BlockNotePlanService;
  exporter: BlockNotePdfExporter;
  docxExporter: BlockNoteDocxExporter;
  picker: PlanImagePicker;
  saver: PdfSaveTarget;
  docxSaver: DocxSaveTarget;
  screenCapture?: ScreenCapture;
  logger: WorkspaceLogger;
}
