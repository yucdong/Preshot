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
      label: "场地图片",
      collection: artifact.gallery,
      compact: false,
    }];
  }
  if (artifact.kind === "modelCard") {
    return [{
      label: "样片",
      collection: artifact.samples,
      compact: false,
    }];
  }
  if (artifact.kind === "clothing") {
    return [{
      label: "服装主图",
      collection: artifact.mainGallery,
      compact: false,
    }];
  }
  return [{
    label: "道具图片",
    collection: artifact.gallery,
    compact: false,
  }];
}

function artifactMetadata(artifact: ArtifactRecord): string[] {
  if (artifact.kind === "shootingLocation") {
    return [
      ...(artifact.address ? [`地址：${artifact.address}`] : []),
      ...(artifact.description ? [artifact.description] : []),
    ];
  }
  if (artifact.kind === "modelCard") {
    return [
      ...(artifact.heightCm === null ? [] : [`身高：${artifact.heightCm} cm`]),
      ...(artifact.weightKg === null ? [] : [`体重：${artifact.weightKg} kg`]),
      ...(artifact.shoeSize ? [`鞋码：${artifact.shoeSize}`] : []),
      ...(artifact.notes?.trim()
        ? [`其他信息：${artifact.notes.trim()}`]
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
    );
    const width = Math.min(520, prepared.width);
    const height = width / prepared.width * prepared.height;
    galleries.push(new Paragraph({
      children: [new ImageRun({
        data: prepared.bytes,
        type: prepared.type,
        transformation: { width, height },
      })],
    }));
  }
  const horizontal =
    artifact.kind === "shootingLocation" ||
    artifact.kind === "modelCard" ||
    artifact.kind === "clothing" ||
    artifact.kind === "prop";
  if (!horizontal) return [heading, ...metadata, ...galleries];

  const left = [heading, ...metadata];
  const right = galleries.length > 0 ? galleries : [new Paragraph("")];
  return new Table({
    borders: BORDERLESS,
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [
        new TableCell({
          borders: BORDERLESS,
          children: left,
          width: { size: 40, type: WidthType.PERCENTAGE },
        }),
        new TableCell({
          borders: BORDERLESS,
          children: right,
          width: { size: 60, type: WidthType.PERCENTAGE },
        }),
      ],
    })],
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
) {
  const logicalWidth = 1008;
  const displayImages = compactArtifactGalleryImages(
    collection.images,
    logicalWidth,
    compact,
  );
  const layout = layoutDocumentImageGroupForWidth(
    displayImages,
    logicalWidth,
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
  const defaultBlockMapping = {
    ...docxDefaultSchemaMappings.blockMapping,
  };
  Reflect.deleteProperty(defaultBlockMapping, "column");
  Reflect.deleteProperty(defaultBlockMapping, "columnList");
  const blockMapping = mapping.createBlockMapping<
    DocxBlockValue,
    ParagraphChild
  >({
    ...defaultBlockMapping,
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
    imageGroup: options.imageGroupMapping,
    shootingLocation: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "shootingLocation") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source));
    },
    modelCard: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "modelCard") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source));
    },
    clothing: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "clothing") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source));
    },
    prop: (block, exporter) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "prop") {
        throw new Error(`DOCX artifact "${block.props.artifactId}" is missing`);
      }
      return artifactDocxBlocks(artifact, (source) => exporter.resolveFile(source));
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
