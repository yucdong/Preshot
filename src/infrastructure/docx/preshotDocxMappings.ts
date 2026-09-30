import { resolveArtifactContentLayout } from "../../domain/plan/canvas/artifactContentLayout";
import { ui } from "../../shared/i18n/ui";
import {
  COLORS_DEFAULT,
  mappingFactory,
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
import type {
  ArtifactRecord,
  ImageCollection,
} from "../../domain/plan/canvas/blockDocument";
import { layoutDocumentImageGroupForWidth } from "../../domain/plan/canvas/documentImageGroupLayout";
import { imageCropForView } from "../../domain/plan/canvas/imageView";
import { compactArtifactGalleryImages } from "../../features/plan/blocknote/artifactGallerySizing";
import { COLUMN_GAP } from "../../domain/plan/canvas/columnLayout";

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
  readonly artifacts?: readonly ArtifactRecord[];
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

function artifactTitle(artifact: ArtifactRecord): string {
  if (artifact.kind === "shootingLocation") return artifact.venueName;
  if (artifact.kind === "modelCard") return artifact.modelId;
  return artifact.title;
}

function artifactCollections(artifact: ArtifactRecord): Array<{
  label: string;
  collection: ImageCollection;
  compact: boolean;
}> {
  if (artifact.kind === "shootingLocation") {
    return [{
      label: ui("场地图片"),
      collection: artifact.gallery,
      compact: false,
    }];
  }
  if (artifact.kind === "modelCard") {
    return [{
      label: ui("样片"),
      collection: artifact.samples,
      compact: false,
    }];
  }
  if (artifact.kind === "clothing") {
    return [{
      label: ui("服装主图"),
      collection: artifact.mainGallery,
      compact: false,
    }];
  }
  return [{
    label: ui("道具图片"),
    collection: artifact.gallery,
    compact: false,
  }];
}

function artifactMetadata(artifact: ArtifactRecord): string[] {
  if (artifact.kind === "shootingLocation") {
    return [
      ...(artifact.address ? [ui("地址：{{v0}}", { v0: artifact.address })] : []),
      ...(artifact.description ? [artifact.description] : []),
    ];
  }
  if (artifact.kind === "modelCard") {
    return [
      ...(artifact.heightCm === null ? [] : [ui("身高：{{v0}} cm", { v0: artifact.heightCm })]),
      ...(artifact.weightKg === null ? [] : [ui("体重：{{v0}} kg", { v0: artifact.weightKg })]),
      ...(artifact.shoeSize ? [ui("鞋码：{{v0}}", { v0: artifact.shoeSize })] : []),
      ...(artifact.notes?.trim()
        ? [ui("其他信息：{{v0}}", { v0: artifact.notes.trim() })]
        : []),
    ];
  }
  if (artifact.kind === "clothing") {
    return artifact.source.trim() ? [artifact.source] : [];
  }
  return artifact.source.trim() ? [artifact.source] : [];
}

async function artifactDocxBlocks(
  artifact: ArtifactRecord,
  resolveFile: (source: string) => Promise<Blob>,
  columnWidthTwips?: number,
  rootWidthTwips = 10946,
): Promise<Paragraph[] | Table> {
  const heading = new Paragraph({
    text: artifactTitle(artifact),
    heading: "Heading2",
    keepNext: true,
  });
  const metadata = artifactMetadata(artifact).map((text) =>
    new Paragraph({
      children: [new TextRun(text)],
      keepNext: true,
    })
  );
  const logicalWidth = (columnWidthTwips ?? rootWidthTwips) / rootWidthTwips * 1008;
  const layout = resolveArtifactContentLayout(artifact.kind === "modelCard"
    ? { orientation: "horizontal", textFirst: true, textShare: 0.4, minHeight: 160 }
    : artifact.contentLayout, logicalWidth);
  const horizontal = layout.orientation === "horizontal";
  const galleryLogicalWidth = logicalWidth * (horizontal ? 1 - layout.textShare : 1);
  const galleries: Paragraph[] = [];
  for (
    const {
      label,
      collection,
      compact,
    } of artifactCollections(artifact)
  ) {
    if (collection.images.length === 0) continue;
    galleries.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true })],
      keepNext: true,
    }));
    const prepared = await prepareArtifactCollectionImage(
      collection,
      resolveFile,
      compact,
      galleryLogicalWidth,
      1008 * (horizontal ? 1 - layout.textShare : 1),
    );
    const width = Math.min((columnWidthTwips ?? rootWidthTwips) / 15 * (horizontal ? 1 - layout.textShare : 1), prepared.width);
    const height = width / prepared.width * prepared.height;
    galleries.push(new Paragraph({
      children: [new ImageRun({
        data: prepared.bytes,
        type: prepared.type,
        transformation: { width, height },
      })],
    }));
  }
  const text = [heading, ...metadata];
  const pictures = galleries.length > 0 ? galleries : [new Paragraph("")];
  const regions = layout.textFirst
    ? [{ children: text, share: layout.textShare }, { children: pictures, share: 1 - layout.textShare }]
    : [{ children: pictures, share: 1 - layout.textShare }, { children: text, share: layout.textShare }];
  const minimum = artifact.kind === "modelCard" ? 0 : layout.minHeight / 1008 * rootWidthTwips;
  return new Table({
    borders: BORDERLESS, layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: horizontal ? [new TableRow({
      height: { value: Math.round(minimum), rule: "atLeast" },
      children: regions.map(region => new TableCell({ borders: BORDERLESS, children: region.children,
        width: { size: region.share * 100, type: WidthType.PERCENTAGE } })),
    })] : regions.map(region => new TableRow({
      height: { value: Math.round(minimum * region.share), rule: "atLeast" },
      children: [new TableCell({ borders: BORDERLESS, children: region.children,
        width: { size: 100, type: WidthType.PERCENTAGE } })],
    })),
  });
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to encode artifact gallery for DOCX"));
    }, "image/png");
  });
}

async function prepareArtifactCollectionImage(
  collection: ImageCollection,
  resolveFile: (source: string) => Promise<Blob>,
  compact: boolean,
  columnWidth?: number,
  referenceWidth?: number,
) {
  const logicalWidth = columnWidth ?? 1008;
  const displayImages = compactArtifactGalleryImages(
    collection.images,
    logicalWidth,
    compact && columnWidth === undefined,
  );
  const layout = layoutDocumentImageGroupForWidth(
    displayImages,
    logicalWidth,
    referenceWidth,
  );
  const scale = Math.min(1.5, 8192 / Math.max(logicalWidth, layout.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(logicalWidth * scale));
  canvas.height = Math.max(1, Math.ceil(layout.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Unable to compose artifact gallery for DOCX");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const images = new Map(displayImages.map((image) => [image.id, image]));
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const slot of layout.slots) {
      const image = images.get(slot.id);
      if (!image) continue;
      const bitmap = await createImageBitmap(await resolveFile(image.file));
      bitmaps.push(bitmap);
      const crop = image.fitMode === "stretch"
        ? { x: 0, y: 0, width: 1, height: 1 }
        : imageCropForView(image);
      context.drawImage(
        bitmap,
        crop.x * bitmap.width,
        crop.y * bitmap.height,
        crop.width * bitmap.width,
        crop.height * bitmap.height,
        slot.x * scale,
        slot.y * scale,
        slot.width * scale,
        slot.height * scale,
      );
    }
    return prepareDocxImage(await canvasPng(canvas));
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
    canvas.width = 1;
    canvas.height = 1;
    canvas.remove();
  }
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

function mediaLabel(kind: "audio" | "file" | "video"): string {
  return kind === "audio" ? ui("音频") : kind === "video" ? ui("视频") : ui("文件");
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
  const name = props.name || props.caption || ui("未命名{{v0}}", { v0: label });
  const external = /^https?:\/\//i.test(props.url ?? "");
  const suffix = external
    ? ""
    : props.url
      ? ui("（项目本地资源，未嵌入）")
      : ui("（未附加源文件）");
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
  const defaultBlockMapping = {
    ...docxDefaultSchemaMappings.blockMapping,
  };
  const blockMapping = mapping.createBlockMapping<
    DocxBlockValue,
    ParagraphChild
  >({
    ...defaultBlockMapping,
    column: (block, _exporter, _level, _index, children) => new TableCell({
      borders: BORDERLESS,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      width: { size: Math.round(options.nativeImageContainerWidthTwipsByBlockId?.[block.id] ?? options.contentWidthTwips), type: WidthType.DXA },
      children: [...(children ?? []).flat() as Array<Paragraph | Table>, new Paragraph({ spacing: { after: 0, before: 0 }, children: [] })],
    }) as unknown as Table,
    columnList: (block, _exporter, _level, _index, children) => {
      const gap = Math.round(COLUMN_GAP / 1008 * options.contentWidthTwips);
      const cells = (children as unknown as TableCell[]).flatMap((cell, index) => index === 0 ? [cell] : [
        new TableCell({ borders: BORDERLESS, margins: { top: 0, bottom: 0, left: 0, right: 0 }, width: { size: gap, type: WidthType.DXA }, children: [new Paragraph({ spacing: { after: 0, before: 0 }, children: [] })] }), cell,
      ]);
      if (cells.length > 63) throw new Error("This column row exceeds DOCX table capacity. Move some columns into a separate row before exporting.");
      return new Table({ borders: BORDERLESS, layout: TableLayoutType.FIXED,
        width: { size: Math.round(options.nativeImageContainerWidthTwipsByBlockId?.[block.id] ?? options.contentWidthTwips), type: WidthType.DXA },
        columnWidths: cells.map(cell => Number(cell.options.width?.size)), rows: [new TableRow({ children: cells })] });
    },
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
      const alternative = block.props.caption || block.props.name || ui("图片");
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
    imageGroup: options.imageGroupMapping,
    shootingLocation: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "shootingLocation") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      const width = options.nativeImageContainerWidthTwipsByBlockId?.[block.id];
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source), width !== undefined && width < options.contentWidthTwips ? width : undefined, options.contentWidthTwips);
    },
    modelCard: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "modelCard") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      const width = options.nativeImageContainerWidthTwipsByBlockId?.[block.id];
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source), width !== undefined && width < options.contentWidthTwips ? width : undefined, options.contentWidthTwips);
    },
    clothing: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "clothing") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      const width = options.nativeImageContainerWidthTwipsByBlockId?.[block.id];
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source), width !== undefined && width < options.contentWidthTwips ? width : undefined, options.contentWidthTwips);
    },
    prop: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "prop") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      const width = options.nativeImageContainerWidthTwipsByBlockId?.[block.id];
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source), width !== undefined && width < options.contentWidthTwips ? width : undefined, options.contentWidthTwips);
    },
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
