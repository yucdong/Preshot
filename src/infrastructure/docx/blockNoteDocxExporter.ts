import type { Block } from "@blocknote/core";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import type {
  PreshotPdfExportContext,
} from "../../domain/plan/blocknote/pdfExportPreflight";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteSchema,
  type PreshotBlockSchema,
  type PreshotInlineContentSchema,
  type PreshotStyleSchema,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import {
  createPreshotPdfExportContext,
  type PdfImageMeasurer,
} from "../pdf/blockNotePdfPreflight";
import type { PdfImageOptimizer } from "../pdf/pdfImageOptimizer";
import type { RasterImageOptimizer } from "../pdf/pdfImageOptimizer";
import { composePreshotDocxImageGroupInBrowser } from "./browserDocxImageGroupCompositor";
import { prepareDocxImageGroupAssets } from "./docxImageGroupAssets";
import {
  createPreshotImageGroupDocxBlockMapping,
  type PreshotDocxImageGroupCompositor,
  type PreshotDocxImageGroupWarning,
} from "./imageGroupDocxMapping";
import { createPreshotDocxExporter } from "./preshotDocxExporter";

type ExportContext = PreshotPdfExportContext<PreshotBlockNoteSchema>;

export type BlockNoteDocxExportStage = "preflight" | "mapping" | "render";

export class BlockNoteDocxExportError extends Error {
  constructor(
    readonly stage: BlockNoteDocxExportStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BlockNoteDocxExportError";
  }
}

export interface BlockNoteDocxExporter {
  readonly implementation: "blocknote-docx";
  export(
    plan: ProjectPlanV14,
    resolvedAssets: Record<string, string>,
  ): Promise<Uint8Array>;
}

export interface BlockNoteDocxExporterOptions {
  readonly compositor?: PreshotDocxImageGroupCompositor;
  readonly optimizeImage?: PdfImageOptimizer;
  readonly optimizeDocxImage?: RasterImageOptimizer;
  readonly measureImage?: PdfImageMeasurer;
  readonly onWarning?: (
    warning: PreshotDocxImageGroupWarning,
  ) => void | Promise<void>;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertDocxBytes(bytes: Uint8Array): void {
  if (
    bytes.length <= 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b
  ) {
    throw new BlockNoteDocxExportError(
      "render",
      "BlockNote DOCX rendering returned an empty or invalid ZIP document.",
    );
  }
}

export function createBlockNoteDocxExporter(
  options: BlockNoteDocxExporterOptions = {},
): BlockNoteDocxExporter {
  const compositor =
    options.compositor ?? composePreshotDocxImageGroupInBrowser;

  return {
    implementation: "blocknote-docx",
    async export(plan, resolvedAssets) {
      const exportPlan = structuredClone(plan);
      const exportAssets = { ...resolvedAssets };
      let context: ExportContext;
      let preparedImageGroups: Awaited<
        ReturnType<typeof prepareDocxImageGroupAssets>
      >;
      try {
        context = await createPreshotPdfExportContext({
          plan: exportPlan,
          schema: preshotBlockNoteSchema,
          resolvedAssets: exportAssets,
          visualContract: PDF_VISUAL_CONTRACT,
        }, {
          optimizeImage: options.optimizeImage,
          measureImage: options.measureImage,
        });
        preparedImageGroups = await prepareDocxImageGroupAssets(
          context,
          exportAssets,
          options.optimizeDocxImage,
        );
      } catch (error) {
        const reason = detail(error).replaceAll("PDF", "DOCX");
        throw new BlockNoteDocxExportError(
          "preflight",
          `Unable to prepare the BlockNote document for DOCX export: ${reason}`,
          { cause: error },
        );
      }

      const imageGroupMapping = createPreshotImageGroupDocxBlockMapping(
        context,
        {
          compositor,
          requestsByBlockId: preparedImageGroups.requestsByBlockId,
          onWarning: options.onWarning,
        },
      );
      const exporter = createPreshotDocxExporter({
        imageGroupMapping: async (block) => {
          try {
            return await imageGroupMapping(block);
          } catch (error) {
            throw new BlockNoteDocxExportError(
              "mapping",
              `Unable to map DOCX block "${block.id}" (imageGroup), group "${
                String(block.props.groupId ?? "<missing>")
              }": ${detail(error)}`,
              { cause: error },
            );
          }
        },
        nativeImageLayoutByBlockId: Object.fromEntries(
          Object.entries(context.nativeImagesByBlockId).map(
            ([blockId, image]) => [blockId, {
              widthPoints: image.pdfWidth,
              heightPoints: image.pdfHeight,
            }],
          ),
        ),
      });

      let blob: Blob;
      try {
        blob = await exporter.export(
          exportPlan.document.blocks as Block<
            PreshotBlockSchema,
            PreshotInlineContentSchema,
            PreshotStyleSchema
          >[],
          {
            assets: exportAssets,
            metadata: {
              title: exportPlan.title,
              subject: "Preshot 摄影计划",
              description: `Preshot 摄影计划：${exportPlan.title}`,
            },
          },
        );
      } catch (error) {
        if (
          error instanceof BlockNoteDocxExportError
        ) {
          throw error;
        }
        throw new BlockNoteDocxExportError(
          "mapping",
          `Unable to map the BlockNote document to DOCX: ${detail(error)}`,
          { cause: error },
        );
      }

      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        assertDocxBytes(bytes);
        return bytes;
      } catch (error) {
        if (error instanceof BlockNoteDocxExportError) throw error;
        throw new BlockNoteDocxExportError(
          "render",
          `Unable to pack the DOCX document: ${detail(error)}`,
          { cause: error },
        );
      }
    },
  };
}
