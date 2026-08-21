import type { WorkspaceLogger } from "../../../domain/workspace/ports";
import type {
  DocxSaveTarget,
  PdfSaveTarget,
} from "../../../domain/plan/canvas/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import type { PlanImagePicker, ScreenCapture } from "../../../domain/plan/ports";
import type { BlockNoteDocxExporter } from "../../../infrastructure/docx/blockNoteDocxExporter";
import type { BlockNotePdfExporter } from "../../../infrastructure/pdf/blockNotePdfExporter";
import type { LongImageSaveTarget } from "../../../domain/plan/longImageSave";
import type {
  LongImageExportResult,
  LongImagePresetId,
  LongImageWidth,
} from "../../../domain/plan/blocknote/longImageExportContract";
import type { ProjectPlanV14 } from "../../../domain/plan/canvas/blockDocument";

export type LongImageExportPhase =
  | "prepare"
  | "assets"
  | "layout"
  | "render"
  | "encode";

export interface LongImageExportProgress {
  readonly phase: LongImageExportPhase;
  readonly partNumber?: number;
  readonly partCount?: number;
}

export interface LongImageExportRequest {
  readonly plan: ProjectPlanV14;
  readonly resolvedAssets: Readonly<Record<string, string>>;
  readonly preset: LongImagePresetId;
  readonly options?: {
    readonly allowSplit?: boolean;
    readonly width?: LongImageWidth;
    readonly theme?: "light" | "dark";
    readonly timeoutMs?: number;
  };
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LongImageExportProgress) => void;
}

export interface LongImageExporter {
  export(request: LongImageExportRequest): Promise<LongImageExportResult>;
}

export interface PlanDependencies {
  service: BlockNotePlanService;
  exporter: BlockNotePdfExporter;
  docxExporter: BlockNoteDocxExporter;
  longImageExporter: LongImageExporter;
  picker: PlanImagePicker;
  saver: PdfSaveTarget;
  docxSaver: DocxSaveTarget;
  longImageSaver: LongImageSaveTarget;
  screenCapture?: ScreenCapture;
  logger: WorkspaceLogger;
}
