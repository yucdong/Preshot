import type { Block } from "@blocknote/core";
import { DOCXExporter } from "@blocknote/xl-docx-exporter";
import {
  Packer,
  PageOrientation,
  Paragraph,
  Tab,
  Table,
  TextRun,
} from "docx";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteSchema,
  type PreshotBlockSchema,
  type PreshotInlineContentSchema,
  type PreshotStyleSchema,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import type { ArtifactRecord } from "../../domain/plan/canvas/blockDocument";
import {
  PRESHOT_DOCX_COLUMN_GAP_TWIPS,
  allocateWeightedWidths,
  createPreshotDocxMappings,
  type PreshotImageGroupDocxMapping,
} from "./preshotDocxMappings";

export { PRESHOT_DOCX_COLUMN_GAP_TWIPS };

export const PRESHOT_DOCX_A4 = Object.freeze({
  widthTwips: 11_906,
  heightTwips: 16_838,
  marginTwips: 480,
  contentWidthTwips: 10_946,
  contentHeightTwips: 15_878,
});
export const PRESHOT_DOCX_MAX_LIST_LEVEL = 8;

export type PreshotDocxAssetData =
  | Blob
  | string
  | {
      readonly data: ArrayBuffer | Uint8Array;
      readonly mimeType: string;
    };

export interface PreshotDocxMetadata {
  readonly title?: string;
  readonly subject?: string;
  readonly creator?: string;
  readonly keywords?: string;
  readonly description?: string;
}

export interface PreshotDocxExportOptions {
  readonly assets?: Readonly<Record<string, PreshotDocxAssetData>>;
  readonly metadata?: PreshotDocxMetadata;
}

export interface PreshotDocxExporterFactoryOptions {
  readonly artifacts?: readonly ArtifactRecord[];
  readonly imageGroupMapping?: PreshotImageGroupDocxMapping;
  readonly nativeImageLayoutByBlockId?: Readonly<Record<
    string,
    {
      readonly widthPoints: number;
      readonly heightPoints: number;
    }
  >>;
}

export interface PreshotDocxExporter {
  readonly implementation: "blocknote-docx";
  readonly schema: PreshotBlockNoteSchema;
  export(
    blocks: Block<
      PreshotBlockSchema,
      PreshotInlineContentSchema,
      PreshotStyleSchema
    >[],
    options?: PreshotDocxExportOptions,
  ): Promise<Blob>;
}

const LIST_BLOCK_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);
const COLUMN_BOUNDARY_TYPES = new Set(["columnList", "column"]);
const PRIVATE_PROJECT_ASSET = /^(?:media|references)\/[^/\\]+$/i;

class PreshotOfflineDocxExporter extends DOCXExporter<
  PreshotBlockSchema,
  PreshotStyleSchema,
  PreshotInlineContentSchema
> {
  public override async transformBlocks(
    blocks: Block<
      PreshotBlockSchema,
      PreshotInlineContentSchema,
      PreshotStyleSchema
    >[],
    listLevel = 0,
  ): Promise<Array<Paragraph | Table>> {
    const result: Array<Paragraph | Table> = [];

    for (const block of blocks) {
      const childListLevel = COLUMN_BOUNDARY_TYPES.has(block.type)
        ? 0
        : listLevel + (LIST_BLOCK_TYPES.has(block.type) ? 1 : 0);
      let children = await this.transformBlocks(
        block.children,
        childListLevel,
      );

      if (!COLUMN_BOUNDARY_TYPES.has(block.type)) {
        children = children.map((child) => {
          if (
            child instanceof Paragraph &&
            (child as unknown as {
              readonly properties: {
                readonly numberingReferences: readonly unknown[];
              };
            }).properties.numberingReferences.length === 0
          ) {
            child.addRunToFront(new TextRun({ children: [new Tab()] }));
          }
          return child;
        });
      }

      const mapped = await this.mapBlock(
        block as Parameters<typeof this.mapBlock>[0],
        listLevel,
        0,
        children,
      );
      if (COLUMN_BOUNDARY_TYPES.has(block.type)) {
        result.push(mapped as Table);
      } else if (Array.isArray(mapped)) {
        result.push(...mapped, ...children);
      } else {
        result.push(mapped, ...children);
      }
    }

    return result;
  }

  protected override async getFonts(): Promise<[]> {
    return [];
  }
}

function missingImageGroupMapping(): never {
  throw new Error(
    "DOCX imageGroup rendering requires an injected Preshot mapping.",
  );
}

function assertSupportedListNesting(
  blocks: readonly Block<
    PreshotBlockSchema,
    PreshotInlineContentSchema,
    PreshotStyleSchema
  >[],
  listLevel = 0,
): void {
  for (const block of blocks) {
    if (
      LIST_BLOCK_TYPES.has(block.type) &&
      listLevel > PRESHOT_DOCX_MAX_LIST_LEVEL
    ) {
      throw new Error(
        `Word supports list levels 0-${PRESHOT_DOCX_MAX_LIST_LEVEL}; block "${block.id}" is at level ${listLevel}. Preshot rejects over-depth lists instead of clamping them.`,
      );
    }
    const childListLevel = COLUMN_BOUNDARY_TYPES.has(block.type)
      ? 0
      : listLevel + (LIST_BLOCK_TYPES.has(block.type) ? 1 : 0);
    assertSupportedListNesting(block.children, childListLevel);
  }
}

function dataUrlBlob(value: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) {
    throw new Error("DOCX project image data is not a valid data URL.");
  }
  const mimeType = match[1] || "application/octet-stream";
  const encoded = match[3] ?? "";
  if (match[2]) {
    const decoded = atob(encoded);
    return new Blob([
      Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
    ], { type: mimeType });
  }
  return new Blob([decodeURIComponent(encoded)], { type: mimeType });
}

function assetBlob(asset: PreshotDocxAssetData): Blob {
  if (asset instanceof Blob) return asset;
  if (typeof asset === "string") return dataUrlBlob(asset);
  return new Blob([asset.data], { type: asset.mimeType });
}

function nativeImageContainerWidths(
  blocks: readonly Block<
    PreshotBlockSchema,
    PreshotInlineContentSchema,
    PreshotStyleSchema
  >[],
  rootWidthTwips: number,
): Readonly<Record<string, number>> {
  const widths: Record<string, number> = {};
  const visit = (
    entries: readonly Block<
      PreshotBlockSchema,
      PreshotInlineContentSchema,
      PreshotStyleSchema
    >[],
    parentWidthTwips: number,
  ) => {
    for (const block of entries) {
      if (block.type === "image") widths[block.id] = parentWidthTwips;
      if (block.type === "columnList" && block.children.length > 0) {
        const availableWidth =
          parentWidthTwips -
          (block.children.length - 1) * PRESHOT_DOCX_COLUMN_GAP_TWIPS;
        const weights = block.children.map((column) => {
          const weight = Number(
            (column.props as { readonly width?: unknown }).width,
          );
          return Number.isFinite(weight) && weight > 0 ? weight : 1;
        });
        const columnWidths = allocateWeightedWidths(weights, availableWidth);
        block.children.forEach((column, index) => {
          visit(column.children, columnWidths[index]!);
        });
      } else {
        visit(block.children, parentWidthTwips);
      }
    }
  };
  visit(blocks, rootWidthTwips);
  return widths;
}

function createPrivateAssetResolver(
  assets: Readonly<Record<string, PreshotDocxAssetData>>,
): (source: string) => Promise<Blob> {
  return async (source) => {
    if (source.startsWith("data:")) return dataUrlBlob(source);
    if (!PRIVATE_PROJECT_ASSET.test(source)) {
      throw new Error(
        "DOCX native images require local project image data; network and filesystem paths are not allowed.",
      );
    }

    const asset = assets[source];
    if (!asset) {
      throw new Error(
        "DOCX native images require local project image data supplied by the caller.",
      );
    }
    return assetBlob(asset);
  };
}

export function createPreshotDocxExporter(
  factoryOptions: PreshotDocxExporterFactoryOptions = {},
): PreshotDocxExporter {
  const imageGroupMapping =
    factoryOptions.imageGroupMapping ?? missingImageGroupMapping;

  return {
    implementation: "blocknote-docx",
    schema: preshotBlockNoteSchema,
    async export(blocks, options = {}) {
      assertSupportedListNesting(blocks);
      const mappings = createPreshotDocxMappings({
        artifacts: factoryOptions.artifacts,
        imageGroupMapping,
        contentWidthTwips: PRESHOT_DOCX_A4.contentWidthTwips,
        contentHeightTwips: PRESHOT_DOCX_A4.contentHeightTwips,
        nativeImageContainerWidthTwipsByBlockId:
          nativeImageContainerWidths(
            blocks,
            PRESHOT_DOCX_A4.contentWidthTwips,
          ),
        nativeImageLayoutByBlockId:
          factoryOptions.nativeImageLayoutByBlockId,
      });
      const exporter = new PreshotOfflineDocxExporter(
        preshotBlockNoteSchema,
        mappings,
        {
          resolveFileUrl: createPrivateAssetResolver(options.assets ?? {}),
        },
      );
      const metadata = options.metadata ?? {};
      const document = await exporter.toDocxJsDocument(blocks, {
        locale: "zh-CN",
        documentOptions: {
          title: metadata.title ?? "Preshot 摄影计划",
          subject: metadata.subject ?? "摄影计划",
          creator: metadata.creator ?? "Preshot",
          keywords: metadata.keywords ?? "Preshot, 摄影计划, 摄影",
          description:
            metadata.description ?? "由 Preshot 导出的离线摄影计划文档",
          lastModifiedBy: "Preshot",
        },
        sectionOptions: {
          properties: {
            page: {
              size: {
                width: PRESHOT_DOCX_A4.widthTwips,
                height: PRESHOT_DOCX_A4.heightTwips,
                orientation: PageOrientation.PORTRAIT,
              },
              margin: {
                top: PRESHOT_DOCX_A4.marginTwips,
                right: PRESHOT_DOCX_A4.marginTwips,
                bottom: PRESHOT_DOCX_A4.marginTwips,
                left: PRESHOT_DOCX_A4.marginTwips,
              },
            },
          },
        },
      });
      return Packer.toBlob(document);
    },
  };
}
