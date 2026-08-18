import type { Block } from "@blocknote/core";
import { pdf } from "@react-pdf/renderer";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import {
  PreshotPdfPreflightError,
  type PreshotPdfExportContext,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteSchema,
  type PreshotBlockSchema,
  type PreshotInlineContentSchema,
  type PreshotStyleSchema,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import type { BlockNotePdfExporter } from "./blockNotePdfExporter";
import {
  createPreshotPdfExportContext,
  type PdfImageMeasurer,
} from "./blockNotePdfPreflight";
import {
  createPreshotImageGroupPdfBlockMapping,
  type PreshotImageGroupPdfBlockMapping,
} from "./imageGroupPdfMapping";
import {
  createPreshotReactPdfExporter,
  type PreshotImageGroupPdfMapping,
} from "./blockNoteReactPdfMappings";
import type { PdfImageOptimizer } from "./pdfImageOptimizer";

type ExportContext = PreshotPdfExportContext<PreshotBlockNoteSchema>;
type PdfDocumentElement = NonNullable<Parameters<typeof pdf>[0]>;
type PdfRenderResult = Blob | Uint8Array;

export type BlockNotePdfExportStage = "mapping" | "render";

export class BlockNotePdfExportError extends Error {
  constructor(
    readonly stage: BlockNotePdfExportStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BlockNotePdfExportError";
  }
}

export interface ReactPdfBlockNoteExporterOptions {
  readonly optimizeImage?: PdfImageOptimizer;
  readonly measureImage?: PdfImageMeasurer;
  readonly fontSources?: {
    readonly regular: string;
    readonly bold: string;
  };
  readonly createImageGroupMapping?: (
    context: ExportContext,
  ) => PreshotImageGroupPdfBlockMapping;
  readonly renderDocument?: (
    document: PdfDocumentElement,
  ) => Promise<PdfRenderResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exportContextSummary(
  plan: ProjectPlanV14,
  context?: ExportContext,
): string {
  const blocks = context?.blocks.map(
    (block) => `${block.blockId}:${block.blockType}`,
  ) ?? plan.document.blocks.map((block) => `${block.id}:${block.type}`);
  const groups = context?.groups.map(
    (group) => `${group.blockId}/${group.groupId}`,
  ) ?? plan.imageGroups.map((group) => group.id);
  const assets = context?.assets.map(
    (asset) => `${asset.assetId}:${asset.source}`,
  ) ?? [];
  return `blocks [${blocks.join(", ") || "none"}]; groups [${
    groups.join(", ") || "none"
  }]; assets [${assets.join(", ") || "none"}]`;
}

function assertPdfBytes(
  bytes: Uint8Array,
  plan: ProjectPlanV14,
  context: ExportContext,
): void {
  const isPdf = bytes.length > 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  if (!isPdf) {
    throw new BlockNotePdfExportError(
      "render",
      `React-PDF returned an empty or invalid PDF (${
        exportContextSummary(plan, context)
      }).`,
    );
  }
}

export async function renderReactPdfDocumentToBytes(
  document: PdfDocumentElement,
): Promise<Uint8Array> {
  const blob = await pdf(document).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

function contextualImageGroupMapping(
  context: ExportContext,
  createMapping: (
    context: ExportContext,
  ) => PreshotImageGroupPdfBlockMapping,
): PreshotImageGroupPdfMapping {
  const mapping = createMapping(context);
  return ((block) => {
    try {
      return mapping(block);
    } catch (error) {
      const groupId = String(block.props.groupId ?? "<missing>");
      throw new BlockNotePdfExportError(
        "mapping",
        `Unable to map PDF block "${block.id}" (imageGroup), group "${groupId}": ${errorMessage(
          error,
        )}`,
        { cause: error },
      );
    }
  }) as PreshotImageGroupPdfMapping;
}

export function createReactPdfBlockNoteExporter(
  options: ReactPdfBlockNoteExporterOptions = {},
): BlockNotePdfExporter & { readonly schema: PreshotBlockNoteSchema } {
  const createImageGroupMapping =
    options.createImageGroupMapping ??
    createPreshotImageGroupPdfBlockMapping;
  const renderDocument = options.renderDocument ??
    renderReactPdfDocumentToBytes;

  return {
    implementation: "react-pdf",
    schema: preshotBlockNoteSchema,
    async export(
      plan: ProjectPlanV14,
      resolvedAssets: Record<string, string>,
    ): Promise<Uint8Array> {
      const exportPlan = structuredClone(plan);
      const exportAssets = { ...resolvedAssets };
      const context = await createPreshotPdfExportContext({
        plan: exportPlan,
        schema: preshotBlockNoteSchema,
        resolvedAssets: exportAssets,
        visualContract: PDF_VISUAL_CONTRACT,
      }, {
        optimizeImage: options.optimizeImage,
        measureImage: options.measureImage,
        captionFontSource: options.fontSources?.regular,
      });

      let document: PdfDocumentElement;
      try {
        const exporter = createPreshotReactPdfExporter(context, {
          imageGroup: contextualImageGroupMapping(
            context,
            createImageGroupMapping,
          ),
          fontSources: options.fontSources,
        });
        document = await exporter.toReactPDFDocument(
          exportPlan.document.blocks as Block<
            PreshotBlockSchema,
            PreshotInlineContentSchema,
            PreshotStyleSchema
          >[],
        ) as PdfDocumentElement;
      } catch (error) {
        if (
          error instanceof PreshotPdfPreflightError ||
          error instanceof BlockNotePdfExportError
        ) {
          throw error;
        }
        throw new BlockNotePdfExportError(
          "mapping",
          `Unable to map the BlockNote document to React-PDF (${exportContextSummary(
            exportPlan,
            context,
          )}): ${errorMessage(error)}`,
          { cause: error },
        );
      }

      try {
        const rendered = await renderDocument(document);
        const bytes = rendered instanceof Blob
          ? new Uint8Array(await rendered.arrayBuffer())
          : new Uint8Array(rendered);
        assertPdfBytes(bytes, exportPlan, context);
        return bytes;
      } catch (error) {
        if (error instanceof BlockNotePdfExportError) throw error;
        throw new BlockNotePdfExportError(
          "render",
          `Unable to render the React-PDF document (${exportContextSummary(
            exportPlan,
            context,
          )}): ${errorMessage(error)}`,
          { cause: error },
        );
      }
    },
  };
}
