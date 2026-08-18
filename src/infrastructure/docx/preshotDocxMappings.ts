import {
  COLORS_DEFAULT,
  mappingFactory,
  type Block,
  type BlockMapping,
  type InlineContentMapping,
  type StyleMapping,
} from "@blocknote/core";
import { docxDefaultSchemaMappings } from "@blocknote/xl-docx-exporter";
import {
  BorderStyle,
  ExternalHyperlink,
  ImageRun,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunPropertiesOptions,
} from "docx";
import {
  preshotBlockNoteSchema,
  type PreshotBlockSchema,
  type PreshotInlineContentSchema,
  type PreshotStyleSchema,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import { prepareDocxImage } from "./browserDocxImage";

export const PRESHOT_DOCX_COLUMN_GAP_TWIPS = 200;

type DocxBlockValue = Paragraph[] | Paragraph | Promise<
  Paragraph[] | Paragraph | Table
> | Table;
type PreshotDocxBlockMapping = BlockMapping<
  PreshotBlockSchema,
  PreshotInlineContentSchema,
  PreshotStyleSchema,
  DocxBlockValue,
  ParagraphChild
>;

export type PreshotImageGroupDocxMapping =
  PreshotDocxBlockMapping["imageGroup"];

export interface PreshotDocxMappings {
  readonly blockMapping: PreshotDocxBlockMapping;
  readonly inlineContentMapping: InlineContentMapping<
    PreshotInlineContentSchema,
    PreshotStyleSchema,
    ParagraphChild,
    TextRun
  >;
  readonly styleMapping: StyleMapping<
    PreshotStyleSchema,
    IRunPropertiesOptions
  >;
}

export interface PreshotDocxMappingOptions {
  readonly imageGroupMapping: PreshotImageGroupDocxMapping;
  readonly contentWidthTwips: number;
  readonly contentHeightTwips: number;
  readonly nativeImageContainerWidthTwipsByBlockId?: Readonly<
    Record<string, number>
  >;
  readonly nativeImageLayoutByBlockId?: Readonly<Record<
    string,
    {
      readonly widthPoints: number;
      readonly heightPoints: number;
    }
  >>;
}

const mapping = mappingFactory(preshotBlockNoteSchema);
const NIL_BORDER = { style: BorderStyle.NIL } as const;
const BORDERLESS = {
  top: NIL_BORDER,
  bottom: NIL_BORDER,
  left: NIL_BORDER,
  right: NIL_BORDER,
  insideHorizontal: NIL_BORDER,
  insideVertical: NIL_BORDER,
} as const;
const SHORT_ATOMIC_COLUMN_BLOCKS = new Set([
  "audio",
  "divider",
  "file",
  "video",
]);

function paragraphOptions(props: {
  readonly textAlignment?: "left" | "center" | "right" | "justify";
  readonly textColor?: string;
  readonly backgroundColor?: string;
}): IParagraphOptions {
  const textColor = props.textColor && props.textColor !== "default"
    ? COLORS_DEFAULT[props.textColor]?.text
    : undefined;
  const backgroundColor =
    props.backgroundColor && props.backgroundColor !== "default"
      ? COLORS_DEFAULT[props.backgroundColor]?.background
      : undefined;
  return {
    alignment: props.textAlignment === "center"
      ? "center"
      : props.textAlignment === "right"
        ? "right"
        : props.textAlignment === "justify"
          ? "distribute"
          : undefined,
    run: textColor ? { color: textColor.slice(1) } : undefined,
    shading: backgroundColor
      ? {
          type: ShadingType.CLEAR,
          fill: backgroundColor.slice(1),
        }
      : undefined,
  };
}

function flattenCellChildren(
  children: readonly Awaited<DocxBlockValue>[],
): Array<Paragraph | Table> {
  return children.flatMap((child) =>
    Array.isArray(child) ? child : [child]
  );
}

export function allocateWeightedWidths(
  weights: readonly number[],
  totalTwips: number,
): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => totalTwips * weight / totalWeight);
  const widths = exact.map(Math.floor);
  const remainder =
    totalTwips - widths.reduce((sum, width) => sum + width, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) =>
      right.fraction - left.fraction || left.index - right.index
    );
  for (let index = 0; index < remainder; index += 1) {
    widths[order[index]!.index] += 1;
  }
  return widths;
}

function isKnownShortAtomicRow(
  mappedBlock: Block<
    PreshotBlockSchema,
    PreshotInlineContentSchema,
    PreshotStyleSchema
  >,
): boolean {
  return mappedBlock.children.length > 0 && mappedBlock.children.every(
    (column) =>
      column.type === "column" &&
      column.children.length > 0 &&
      column.children.every(
        (child) =>
          SHORT_ATOMIC_COLUMN_BLOCKS.has(child.type) &&
          child.children.length === 0,
      ),
  );
}

function mediaLabel(kind: "audio" | "file" | "video"): string {
  return kind === "audio" ? "音频" : kind === "video" ? "视频" : "文件";
}

function mediaFallback(
  kind: "audio" | "file" | "video",
  props: {
    readonly url?: string;
    readonly name?: string;
    readonly caption?: string;
    readonly textAlignment?: "left" | "center" | "right" | "justify";
    readonly textColor?: string;
    readonly backgroundColor?: string;
  },
): Paragraph[] {
  const label = mediaLabel(kind);
  const name = props.name || props.caption || `未命名${label}`;
  const external = /^https?:\/\//i.test(props.url ?? "");
  const suffix = external
    ? ""
    : props.url
      ? "（项目本地资源，未嵌入）"
      : "（未附加源文件）";
  const text = `${label}：${name}${suffix}`;
  const content = external
    ? [
        new ExternalHyperlink({
          link: props.url!,
          children: [new TextRun({ text, style: "Hyperlink" })],
        }),
      ]
    : [new TextRun(text)];
  const paragraphs = [
    new Paragraph({
      ...paragraphOptions(props),
      children: content,
    }),
  ];
  if (props.caption && props.caption !== name) {
    paragraphs.push(new Paragraph({
      ...paragraphOptions(props),
      text: props.caption,
      style: "Caption",
    }));
  }
  return paragraphs;
}

const TWIPS_PER_POINT = 20;
const DOCX_LAYOUT_PIXELS_PER_POINT = 96 / 72;
const CAPTION_FONT_POINTS = 9.35;
const CAPTION_LINE_HEIGHT_POINTS = 12.62;
const CAPTION_GAP_POINTS = 4;
const NATIVE_IMAGE_AFTER_POINTS = 8;

function estimatedCaptionHeight(caption: string, widthPoints: number): number {
  if (!caption.trim()) return 0;
  const measured = Array.from(caption).reduce(
    (sum, character) =>
      sum + (/[\u2e80-\uffff]/u.test(character) ? 1 : 0.55),
    0,
  ) * CAPTION_FONT_POINTS;
  const lines = Math.max(1, Math.ceil(measured / Math.max(1, widthPoints)));
  return lines * CAPTION_LINE_HEIGHT_POINTS + CAPTION_GAP_POINTS;
}

function fallbackNativeImageSize(
  blockId: string,
  previewWidth: number,
  caption: string,
  sourceWidth: number,
  sourceHeight: number,
  options: PreshotDocxMappingOptions,
): { width: number; height: number } {
  const containerTwips =
    options.nativeImageContainerWidthTwipsByBlockId?.[blockId] ??
    options.contentWidthTwips;
  const maxWidth = containerTwips / 15;
  const requestedWidth = previewWidth > 0 ? previewWidth : sourceWidth;
  const unconstrainedWidth = Math.min(requestedWidth, maxWidth);
  const unconstrainedHeight =
    unconstrainedWidth / sourceWidth * sourceHeight;
  const containerPoints = containerTwips / TWIPS_PER_POINT;
  const reservedPoints =
    estimatedCaptionHeight(caption, containerPoints) +
    NATIVE_IMAGE_AFTER_POINTS;
  const maxHeight = Math.max(
    1,
    (options.contentHeightTwips / TWIPS_PER_POINT - reservedPoints) *
      DOCX_LAYOUT_PIXELS_PER_POINT,
  );
  const scale = Math.min(1, maxHeight / unconstrainedHeight);
  return {
    width: unconstrainedWidth * scale,
    height: unconstrainedHeight * scale,
  };
}

export function createPreshotDocxMappings(
  options: PreshotDocxMappingOptions,
): PreshotDocxMappings {
  const blockMapping = mapping.createBlockMapping<
    DocxBlockValue,
    ParagraphChild
  >({
    ...docxDefaultSchemaMappings.blockMapping,
    audio: (block) => mediaFallback("audio", block.props),
    video: (block) => mediaFallback("video", block.props),
    file: (block) => mediaFallback("file", block.props),
    image: async (block, exporter) => {
      const blob = await exporter.resolveFile(block.props.url);
      const image = await prepareDocxImage(blob);
      const planned = options.nativeImageLayoutByBlockId?.[block.id];
      const size = planned
        ? {
            width: planned.widthPoints * DOCX_LAYOUT_PIXELS_PER_POINT,
            height: planned.heightPoints * DOCX_LAYOUT_PIXELS_PER_POINT,
          }
        : fallbackNativeImageSize(
            block.id,
            block.props.previewWidth,
            block.props.caption,
            image.width,
            image.height,
            options,
          );
      const alternative = block.props.caption || block.props.name || "图片";
      return [
        new Paragraph({
          ...paragraphOptions(block.props),
          children: [
            new ImageRun({
              type: image.type,
              data: image.bytes,
              altText: {
                name: alternative,
                title: alternative,
                description: alternative,
              },
              transformation: size,
            }),
          ],
        }),
        ...(block.props.caption
          ? [
              new Paragraph({
                ...paragraphOptions(block.props),
                text: block.props.caption,
                style: "Caption",
              }),
            ]
          : []),
      ];
    },
    column: (
      _block,
      _exporter,
      _nestingLevel,
      _numberedListIndex,
      children,
    ) =>
      new TableCell({
        borders: BORDERLESS,
        margins: {
          marginUnitType: WidthType.DXA,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
        children: flattenCellChildren(children ?? []),
      }) as unknown as Table,
    columnList: (
      block,
      _exporter,
      _nestingLevel,
      _numberedListIndex,
      children,
    ) => {
      const mappedBlock = block as unknown as Block<
        PreshotBlockSchema,
        PreshotInlineContentSchema,
        PreshotStyleSchema
      >;
      const columns = children as unknown as TableCell[];
      const gapCount = Math.max(0, columns.length - 1);
      const availableWidth =
        options.contentWidthTwips -
        gapCount * PRESHOT_DOCX_COLUMN_GAP_TWIPS;
      if (availableWidth <= 0) {
        throw new Error("DOCX column layout has no usable page width.");
      }
      const weights = mappedBlock.children.map((column) => {
        const weight = Number(
          (column.props as { readonly width?: unknown }).width,
        );
        return Number.isFinite(weight) && weight > 0 ? weight : 1;
      });
      const widths = allocateWeightedWidths(weights, availableWidth);
      const cells: TableCell[] = [];
      const gridWidths: number[] = [];
      columns.forEach((column, index) => {
        const width = widths[index]!;
        cells.push(new TableCell({
          borders: BORDERLESS,
          margins: {
            marginUnitType: WidthType.DXA,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
          width: { size: width, type: WidthType.DXA },
          children: column.options.children,
        }));
        gridWidths.push(width);
        if (index < columns.length - 1) {
          cells.push(new TableCell({
            borders: BORDERLESS,
            margins: {
              marginUnitType: WidthType.DXA,
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            },
            width: {
              size: PRESHOT_DOCX_COLUMN_GAP_TWIPS,
              type: WidthType.DXA,
            },
            children: [new Paragraph("")],
          }));
          gridWidths.push(PRESHOT_DOCX_COLUMN_GAP_TWIPS);
        }
      });
      return new Table({
        layout: TableLayoutType.FIXED,
        width: {
          size: options.contentWidthTwips,
          type: WidthType.DXA,
        },
        columnWidths: gridWidths,
        borders: BORDERLESS,
        margins: {
          marginUnitType: WidthType.DXA,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
        rows: [
          new TableRow({
            cantSplit: isKnownShortAtomicRow(mappedBlock)
              ? true
              : undefined,
            children: cells,
          }),
        ],
      });
    },
    imageGroup: options.imageGroupMapping,
  });

  return {
    blockMapping,
    inlineContentMapping: {
      ...docxDefaultSchemaMappings.inlineContentMapping,
    } as PreshotDocxMappings["inlineContentMapping"],
    styleMapping: {
      ...docxDefaultSchemaMappings.styleMapping,
    } as PreshotDocxMappings["styleMapping"],
  };
}
