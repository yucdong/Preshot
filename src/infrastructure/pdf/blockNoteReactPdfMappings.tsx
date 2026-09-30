import { resolveArtifactContentLayout } from "../../domain/plan/canvas/artifactContentLayout";
import { ui, uiLocale } from "../../shared/i18n/ui";
import {
  COLORS_DEFAULT,
  mapTableCell,
  mappingFactory,
  type Block,
  type BlockMapping,
  type InlineContentMapping,
  type StyleMapping,
  type StyledText,
} from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import { editorDictionary } from "../../features/plan/blocknote/editorLanguage";
import {
  PDFExporter,
  pdfDefaultSchemaMappings,
} from "@blocknote/xl-pdf-exporter";
import {
  Document,
  Font,
  Image,
  Link,
  Page,
  Text,
  View,
  type TextProps,
} from "@react-pdf/renderer";
import { Fragment, type ReactElement, type ReactNode } from "react";
import boldFontUrl from "./fonts/NotoSansSC-Bold.ttf?url";
import regularFontUrl from "./fonts/NotoSansSC-Regular.ttf?url";
import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteSchema,
  type PreshotBlockSchema,
  type PreshotInlineContentSchema,
  type PreshotStyleSchema,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import type {
  ArtifactRecord,
  ImageCollection,
} from "../../domain/plan/canvas/blockDocument";
import { layoutDocumentImageGroupForWidth } from "../../domain/plan/canvas/documentImageGroupLayout";
import { COLUMN_GAP } from "../../domain/plan/canvas/columnLayout";
import {
  imageFrameContentCss,
} from "../../domain/plan/canvas/imageView";
import { compactArtifactGalleryImages } from "../../features/plan/blocknote/artifactGallerySizing";
import { layoutPdfCaption } from "../../domain/plan/blocknote/pdfCaptionLayout";
import { createReactPdfCaptionTextMeasurer } from "./reactPdfCaptionMetrics";
import { pdfWordBreaks } from "./pdfWordBreaks";

export const PRESHOT_PDF_FONT_FAMILY = "Preshot Noto Sans SC";
export const PRESHOT_PDF_DICTIONARY = zh;
// Yoga compares rounded node heights, so retain a sub-point page-edge reserve.
const REACT_PDF_PAGE_ROUNDING_TOLERANCE = 0.1;

type PreshotContext = PreshotPdfExportContext<PreshotBlockNoteSchema>;
type PdfTextStyle = NonNullable<TextProps["style"]>;
type PdfBlockResult = ReactElement<Text>;
type PdfInlineResult = ReactElement<Link> | ReactElement<Text>;
type PreshotPdfBlockMapping = BlockMapping<
  PreshotBlockSchema,
  PreshotInlineContentSchema,
  PreshotStyleSchema,
  PdfBlockResult,
  PdfInlineResult
>;

export type PreshotImageGroupPdfMapping =
  PreshotPdfBlockMapping["imageGroup"];

export interface PreshotReactPdfMappings {
  readonly blockMapping: PreshotPdfBlockMapping;
  readonly inlineContentMapping: InlineContentMapping<
    PreshotInlineContentSchema,
    PreshotStyleSchema,
    PdfInlineResult,
    ReactElement<Text>
  >;
  readonly styleMapping: StyleMapping<
    PreshotStyleSchema,
    TextProps["style"]
  >;
}

export interface PreshotReactPdfMappingOptions {
  readonly imageGroup: PreshotImageGroupPdfMapping;
  readonly artifacts?: readonly ArtifactRecord[];
  readonly resolvedAssets?: Readonly<Record<string, string>>;
  readonly fontSources?: {
    readonly regular: string;
    readonly bold: string;
  };
}

function artifactTitle(artifact: ArtifactRecord): string {
  if (artifact.kind === "shootingLocation") return artifact.venueName;
  if (artifact.kind === "modelCard") return artifact.modelId;
  return artifact.title;
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

async function artifactPdfBlock(
  artifact: ArtifactRecord,
  resolvedAssets: Readonly<Record<string, string>>,
  blockId: string,
  fontSources?: PreshotReactPdfMappingOptions["fontSources"],
  columnWidth?: number,
): Promise<PdfBlockResult> {
  const scale = contract.editor.rootLogicalToPdfScale;
  const inset = contract.spacing.table.cellPaddingHorizontal + contract.borders.hairline;
  const cardWidth = columnWidth ?? contract.page.contentWidth;
  const innerWidth = cardWidth - inset * 2;
  const collections = artifactCollections(artifact).filter(({ collection }) => collection.images.length > 0);
  const hasImages = collections.length > 0;
  const columnsWidth = innerWidth - contract.spacing.artifact.regionGap;
  const layout = resolveArtifactContentLayout(artifact.kind === "modelCard"
    ? { orientation: "horizontal", textFirst: true, textShare: 0.4, minHeight: 160 }
    : artifact.contentLayout, innerWidth / scale);
  const horizontal = hasImages && layout.orientation === "horizontal";
  const metadataWidth = horizontal ? columnsWidth * layout.textShare : innerWidth;
  const galleryWidth = horizontal ? columnsWidth * (1 - layout.textShare) : innerWidth;
  const minimum = artifact.kind === "modelCard" ? 0 : layout.minHeight * scale;
  const textMinimum = horizontal ? minimum : minimum * layout.textShare;
  const galleryMinimum = horizontal ? minimum : minimum * (1 - layout.textShare);
  const measureText = await createReactPdfCaptionTextMeasurer(fontSources?.regular);
  const measureTitle = await createReactPdfCaptionTextMeasurer(fontSources?.bold ?? boldFontUrl);
  const titleSize = contract.typography.body.fontSize * 1.2;
  const titleLayout = layoutPdfCaption(artifactTitle(artifact), innerWidth, {
    fontSize: titleSize,
    lineHeight: contract.typography.body.lineHeight * 1.2,
    gap: contract.spacing.paragraph.after,
    measureText: measureTitle,
  });
  const metadataLayouts = artifactMetadata(artifact).map((text) => layoutPdfCaption(text, metadataWidth, {
    ...contract.typography.body,
    gap: contract.spacing.paragraph.after / 2,
    measureText,
  }));
  const metadata = metadataLayouts.map((layout, index) => (
    <Text
      hyphenationCallback={pdfWordBreaks}
      key={`artifact-${blockId}-metadata-${index}`}
      style={{
        ...bodyTextStyle({}),
        width: metadataWidth,
        marginBottom: contract.spacing.paragraph.after / 2,
      }}
    >
      {layout.lines.join("\n")}
    </Text>
  ));
  let galleriesHeight = 0;
  const galleries = collections.map(
    ({ label, collection, compact }) => {
      const gallery = artifactPdfGallery(collection, resolvedAssets, compact, galleryWidth / scale, columnWidth !== undefined);
      galleriesHeight += gallery.height + contract.typography.body.lineHeight + contract.spacing.paragraph.after;
      return (
        <View
          key={`artifact-${blockId}-${collection.id}`}
          style={{ marginTop: contract.spacing.paragraph.after / 2 }}
        >
          <Text
            hyphenationCallback={pdfWordBreaks}
            style={{
              ...bodyTextStyle({}),
              width: galleryWidth,
              fontWeight: 700,
              marginBottom: contract.spacing.paragraph.after / 2,
            }}
          >
            {label}
          </Text>
          {gallery.element}
        </View>
      );
    },
  );
  const metadataHeight = Math.max(textMinimum, metadataLayouts.reduce((height, layout) => height + layout.height, 0));
  galleriesHeight = Math.max(galleryMinimum, galleriesHeight);
  const cardHeight = inset * 2 + titleLayout.height + (horizontal ? Math.max(metadataHeight, galleriesHeight) : metadataHeight + galleriesHeight) + contract.spacing.paragraph.after;
  return (
    <View
      key={`artifact-${blockId}`}
      wrap={cardHeight > contract.page.contentHeight - REACT_PDF_PAGE_ROUNDING_TOLERANCE}
      style={{
        width: cardWidth,
        borderColor: contract.colors.border,
        borderWidth: contract.borders.hairline,
        borderRadius: contract.borders.radius,
        marginBottom: contract.spacing.paragraph.after,
        padding: contract.spacing.table.cellPaddingHorizontal,
      }}
    >
      <Text
        hyphenationCallback={pdfWordBreaks}
        style={{
          ...bodyTextStyle({}),
          width: innerWidth,
          fontSize: titleSize,
          fontWeight: 700,
          marginBottom: contract.spacing.paragraph.after,
        }}
      >
        {titleLayout.lines.join("\n")}
      </Text>
      <View style={{ display: "flex", width: innerWidth, flexDirection: horizontal ? "row" : "column", gap: contract.spacing.artifact.regionGap }}>
        {(layout.textFirst ? ["text", "images"] : ["images", "text"]).map(region => region === "text"
          ? <View key="text" style={{ width: metadataWidth, minHeight: textMinimum, flexShrink: 0 }}>{metadata}</View>
          : <View key="images" style={{ width: galleryWidth, minHeight: galleryMinimum, flexShrink: 0 }}>{galleries}</View>)}
      </View>
    </View>
  ) as PdfBlockResult;
}

function artifactPdfGallery(
  collection: ImageCollection,
  resolvedAssets: Readonly<Record<string, string>>,
  compact: boolean,
  logicalWidth: number,
  inColumn = false,
): { element: ReactElement; height: number } {
  const displayImages = compactArtifactGalleryImages(
    collection.images,
    logicalWidth,
    compact && !inColumn,
  );
  const layout = layoutDocumentImageGroupForWidth(
    displayImages,
    logicalWidth,
    inColumn ? contract.editor.contentWidth : undefined,
  );
  const scale =
    contract.page.contentWidth / contract.editor.contentWidth;
  const images = new Map(displayImages.map((image) => [image.id, image]));
  return { height: layout.height * scale, element: (
    <View
      style={{
        position: "relative",
        width: logicalWidth * scale,
        height: layout.height * scale,
      }}
    >
      {layout.slots.map((slot) => {
        const image = images.get(slot.id);
        if (!image) return null;
        const source = resolvedAssets[image.file];
        if (!source) {
          throw new Error(
            `PDF artifact image "${image.file}" is unresolved`,
          );
        }
        return (
          <View
            key={image.id}
            style={{
              position: "absolute",
              overflow: "hidden",
              left: slot.x * scale,
              top: slot.y * scale,
              width: slot.width * scale,
              height: slot.height * scale,
            }}
          >
            <Image
              src={source}
              style={{
                position: "absolute",
                ...imageFrameContentCss(image),
              }}
            />
          </View>
        );
      })}
    </View>
  ) };
}

const mapping = mappingFactory(preshotBlockNoteSchema);
const contract = PDF_VISUAL_CONTRACT;

function colorValue(
  value: string,
  kind: "background" | "text",
): string | undefined {
  if (!value || value === "default") return undefined;
  return COLORS_DEFAULT[value]?.[kind] ?? value;
}

function blockTextStyle(props: {
  textAlignment?: "left" | "center" | "right" | "justify";
  textColor?: string;
  backgroundColor?: string;
}): PdfTextStyle {
  return {
    textAlign: props.textAlignment,
    color: colorValue(props.textColor ?? "", "text"),
    backgroundColor: colorValue(
      props.backgroundColor ?? "",
      "background",
    ),
  };
}

function bodyTextStyle(props: {
  textAlignment?: "left" | "center" | "right" | "justify";
  textColor?: string;
  backgroundColor?: string;
}): PdfTextStyle {
  return {
    ...blockTextStyle(props),
    fontFamily: PRESHOT_PDF_FONT_FAMILY,
    fontSize: contract.typography.body.fontSize,
    lineHeight:
      contract.typography.body.lineHeight /
      contract.typography.body.fontSize,
    color:
      colorValue(props.textColor ?? "", "text") ??
      contract.colors.ink,
  };
}

function plainText(
  content: ReadonlyArray<{ readonly text?: string }>,
): string {
  return content.map((entry) => entry.text ?? "").join("");
}

function listItem(
  marker: ReactNode,
  content: ReactNode,
  key: string,
): PdfBlockResult {
  return (
    <View
      key={key}
      style={{
        display: "flex",
        flexDirection: "row",
        gap: contract.spacing.list.markerGap,
        marginBottom: contract.spacing.list.itemGap,
        paddingLeft: contract.spacing.list.indent,
      }}
    >
      <Text
        hyphenationCallback={pdfWordBreaks}
        style={{
          fontFamily: PRESHOT_PDF_FONT_FAMILY,
          fontSize: contract.typography.body.fontSize,
          color: contract.colors.ink,
        }}
      >
        {marker}
      </Text>
      <Text hyphenationCallback={pdfWordBreaks} style={{ flex: 1 }}>{content}</Text>
    </View>
  ) as PdfBlockResult;
}

function mediaFallback(
  kind: "audio" | "file" | "image" | "video",
  props: {
    readonly caption?: string;
    readonly name?: string;
    readonly url?: string;
  },
  blockId: string,
): PdfBlockResult {
  const labels = {
    audio: ui("音频"),
    file: ui("文件"),
    image: ui("图片"),
    video: ui("视频"),
  } as const;
  const url = props.url ?? "";
  const defaultName = editorDictionary().file_blocks.add_button_text[kind];
  const name = props.caption || props.name || defaultName;
  const sourceContext = /^https?:\/\//i.test(url)
    ? ui("外部链接")
    : url
      ? ui("项目本地资源：{{v0}}", { v0: url })
      : ui("未附加源文件");
  const text = `[${labels[kind]}] ${name}（${sourceContext}）`;
  const textNode = (
    <Text
      hyphenationCallback={pdfWordBreaks}
      style={{
        ...bodyTextStyle({}),
        color: contract.colors.mutedInk,
      }}
    >
      {text}
    </Text>
  );

  return (
    <View
      key={`${kind}-${blockId}`}
      wrap={false}
      style={{
        borderColor: contract.colors.border,
        borderWidth: contract.borders.hairline,
        borderRadius: contract.borders.radius,
        padding: contract.spacing.table.cellPaddingHorizontal,
        marginBottom: contract.spacing.paragraph.after,
      }}
    >
      {/^https?:\/\//i.test(url)
        ? (
            <Link
              href={url}
              style={{
                fontFamily: PRESHOT_PDF_FONT_FAMILY,
                fontStyle: "normal",
                color: contract.colors.link,
                textDecoration: "underline",
              }}
            >
              {textNode}
            </Link>
          )
        : textNode}
    </View>
  ) as PdfBlockResult;
}

function caption(
  value: string | undefined,
  width?: number,
  lines?: readonly string[],
): ReactElement | undefined {
  if (!value) return undefined;
  return (
    <Text
      hyphenationCallback={pdfWordBreaks}
      style={{
        ...bodyTextStyle({}),
        width,
        color: contract.colors.mutedInk,
        fontSize: contract.typography.body.fontSize * 0.85,
        marginTop: contract.spacing.nativeImage.captionGap,
      }}
    >
      {lines?.join("\n") ?? value}
    </Text>
  );
}

function assetBlob(context: PreshotContext, source: string): Blob {
  const asset = context.assets.find((entry) => entry.source === source);
  if (!asset) {
    throw new Error(
      `React-PDF project-local resolver has no preflight asset for "${source}".`,
    );
  }
  return new Blob([Uint8Array.from(asset.bytes)], { type: asset.mime });
}

export function createPreshotPdfAssetResolver(
  context: PreshotContext,
): (url: string) => Promise<Blob> {
  return async (url) => assetBlob(context, url);
}

export function createPreshotReactPdfMappings(
  context: PreshotContext,
  options: PreshotReactPdfMappingOptions,
): PreshotReactPdfMappings {
  const shortCards = new Set<string>();
  const childIds = new Map<string, string[]>();
  for (const block of context.blocks) {
    if (block.parentBlockId) childIds.set(block.parentBlockId, [...(childIds.get(block.parentBlockId) ?? []), block.blockId]);
  }
  const shortCardRow = (id: string) => {
    const columns = childIds.get(id) ?? [];
    return columns.length >= 2 && columns.every(column => {
      const blocks = childIds.get(column) ?? [];
      return blocks.length === 1 && shortCards.has(blocks[0]);
    });
  };
  const mapArtifact = async (artifact: ArtifactRecord, blockId: string) => {
    const result = await artifactPdfBlock(artifact, options.resolvedAssets ?? {}, blockId, options.fontSources,
      context.blocksById[blockId]?.inColumn ? context.blocksById[blockId].pdfParentWidth : undefined);
    if ((result as ReactElement<{ wrap?: boolean }>).props.wrap === false) shortCards.add(blockId);
    return result;
  };
  const defaultBlockMapping = {
    ...pdfDefaultSchemaMappings.blockMapping,
  };
  const blockMapping = mapping.createBlockMapping<
    PdfBlockResult,
    PdfInlineResult
  >({
    ...defaultBlockMapping,
    column: (block, _exporter, _level, _index, children) => (
      <View key={block.id} style={{ width: context.blocksById[block.id].pdfParentWidth, flexShrink: 0 }}>{children}</View>
    ) as PdfBlockResult,
    columnList: (block, _exporter, _level, _index, children) => (
      <View key={block.id}
        // React-PDF can truncate unbreakable nested cards when splitting their
        // containing flex row. Keep a row of page-sized cards together; tall
        // cards and general text/image columns retain their paginated flow.
        wrap={!shortCardRow(block.id)}
        style={{ flexDirection: "row", gap: COLUMN_GAP * context.blocksById[block.id].logicalToPdfScale, width: context.blocksById[block.id].pdfParentWidth }}>{children}</View>
    ) as PdfBlockResult,
    paragraph: (block, exporter) => (
      <Text
        hyphenationCallback={pdfWordBreaks}
        key={`paragraph-${block.id}`}
        style={{
          ...bodyTextStyle(block.props),
          marginBottom: contract.spacing.paragraph.after,
        }}
        orphans={2}
        widows={2}
      >
        {exporter.transformInlineContent(block.content)}
      </Text>
    ),
    heading: (block, exporter) => {
      const heading =
        contract.typography.headings[
          `h${block.props.level}` as keyof typeof contract.typography.headings
        ];
      return (
        <Text
          hyphenationCallback={pdfWordBreaks}
          key={`heading-${block.id}`}
          style={{
            ...blockTextStyle(block.props),
            color:
              colorValue(block.props.textColor, "text") ??
              contract.colors.ink,
            fontFamily: PRESHOT_PDF_FONT_FAMILY,
            fontWeight: 700,
            fontSize: heading.fontSize,
            lineHeight: heading.lineHeight / heading.fontSize,
            marginBottom: contract.spacing.paragraph.after,
          }}
          minPresenceAhead={heading.lineHeight}
          orphans={2}
          widows={2}
        >
          {exporter.transformInlineContent(block.content)}
        </Text>
      );
    },
    bulletListItem: (block, exporter) =>
      listItem(
        "•",
        exporter.transformInlineContent(block.content),
        `bullet-${block.id}`,
      ),
    numberedListItem: (block, exporter, _nestingLevel, index) =>
      listItem(
        `${index ?? 1}.`,
        exporter.transformInlineContent(block.content),
        `numbered-${block.id}`,
      ),
    checkListItem: (block, exporter) =>
      listItem(
        block.props.checked ? "☒" : "☐",
        exporter.transformInlineContent(block.content),
        `check-${block.id}`,
      ),
    toggleListItem: (block, exporter) =>
      listItem(
        "▸",
        exporter.transformInlineContent(block.content),
        `toggle-${block.id}`,
      ),
    quote: (block, exporter) => (
      <View
        key={`quote-${block.id}`}
        style={{
          borderLeftColor: contract.colors.quoteBorder,
          borderLeftWidth: contract.borders.quote,
          paddingLeft: contract.spacing.quote.paddingLeft,
          marginTop: contract.spacing.quote.before,
          marginBottom: contract.spacing.quote.after,
        }}
      >
        <Text
          hyphenationCallback={pdfWordBreaks}
          style={{
            ...bodyTextStyle(block.props),
            color: contract.colors.mutedInk,
          }}
          orphans={2}
          widows={2}
        >
          {exporter.transformInlineContent(block.content)}
        </Text>
      </View>
    ),
    codeBlock: (block) => (
      <View
        key={`code-${block.id}`}
        style={{
          backgroundColor: contract.colors.codeSurface,
          borderColor: contract.colors.border,
          borderWidth: contract.borders.hairline,
          borderRadius: contract.borders.radius,
          marginTop: contract.spacing.code.before,
          marginBottom: contract.spacing.code.after,
          paddingHorizontal: contract.spacing.code.paddingHorizontal,
          paddingVertical: contract.spacing.code.paddingVertical,
        }}
      >
        <Text
          hyphenationCallback={pdfWordBreaks}
          style={{
            fontFamily: PRESHOT_PDF_FONT_FAMILY,
            fontSize: contract.typography.code.fontSize,
            lineHeight:
              contract.typography.code.lineHeight /
              contract.typography.code.fontSize,
            color: contract.colors.ink,
          }}
          orphans={2}
          widows={2}
        >
          {plainText(block.content)}
        </Text>
      </View>
    ),
    divider: (block) => (
      <View
        key={`divider-${block.id}`}
        style={{
          borderTopColor: contract.colors.border,
          borderTopWidth: contract.borders.hairline,
          marginVertical: contract.spacing.paragraph.after,
        }}
      />
    ),
    pageBreak: (block) => <View break key={`page-break-${block.id}`} />,
    table: (block, exporter) => {
      const headerRows = block.content.headerRows ?? 0;
      const headerCols = block.content.headerCols ?? 0;
      return (
        <View
          key={`table-${block.id}`}
          style={{
            marginTop: contract.spacing.table.before,
            marginBottom: contract.spacing.table.after,
            borderTopColor: contract.colors.border,
            borderTopWidth: contract.borders.hairline,
          }}
        >
          {block.content.rows.map((row, rowIndex) => (
            <View
              key={`table-${block.id}-row-${rowIndex}`}
              wrap={false}
              style={{ display: "flex", flexDirection: "row" }}
            >
              {row.cells.map((rawCell, columnIndex) => {
                const cell = mapTableCell(rawCell);
                const width = block.content.columnWidths[columnIndex];
                const isHeader =
                  rowIndex < headerRows || columnIndex < headerCols;
                return (
                  <View
                    key={`table-${block.id}-${rowIndex}-${columnIndex}`}
                    style={{
                      flexGrow: width ?? 1,
                      flexBasis: 0,
                      paddingHorizontal:
                        contract.spacing.table.cellPaddingHorizontal,
                      paddingVertical:
                        contract.spacing.table.cellPaddingVertical,
                      borderBottomColor: contract.colors.border,
                      borderBottomWidth: contract.borders.hairline,
                      borderLeftColor: contract.colors.border,
                      borderLeftWidth: contract.borders.hairline,
                      borderRightColor: contract.colors.border,
                      borderRightWidth:
                        columnIndex === row.cells.length - 1
                          ? contract.borders.hairline
                          : 0,
                      backgroundColor:
                        colorValue(
                          cell.props.backgroundColor,
                          "background",
                        ) ??
                        (isHeader
                          ? contract.colors.softSurface
                          : contract.colors.paper),
                    }}
                  >
                    <Text
                      hyphenationCallback={pdfWordBreaks}
                      style={{
                        ...bodyTextStyle(cell.props),
                        fontWeight: isHeader ? 700 : 400,
                      }}
                    >
                      {exporter.transformInlineContent(cell.content)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      );
    },
    image: async (block, exporter) => {
      const nativeImage = context.nativeImagesByBlockId[block.id];
      if (!nativeImage) {
        return mediaFallback("image", block.props, block.id);
      }
      const source = await exporter.resolveFile(nativeImage.source);
      return (
        <View
          key={`image-${block.id}`}
          wrap={false}
          style={{
            width: nativeImage.blockWidth,
            marginBottom: nativeImage.blockSpacing,
          }}
        >
          <Image
            src={source}
            style={{
              width: nativeImage.pdfWidth,
              height: nativeImage.pdfHeight,
              objectFit: "contain",
              alignSelf: block.props.textAlignment === "right" ? "flex-end"
                : block.props.textAlignment === "center" ? "center" : "flex-start",
            }}
          />
          {caption(
            block.props.caption,
            nativeImage.captionWidth,
            nativeImage.captionLines,
          )}
        </View>
      );
    },
    audio: (block) =>
      mediaFallback("audio", block.props, block.id),
    video: (block) =>
      mediaFallback("video", block.props, block.id),
    file: (block) =>
      mediaFallback("file", block.props, block.id),
    imageGroup: options.imageGroup,
    shootingLocation: (block) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "shootingLocation") {
        throw new Error(`PDF artifact "${block.props.artifactId}" is missing`);
      }
      return mapArtifact(artifact, block.id);
    },
    modelCard: (block) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "modelCard") {
        throw new Error(`PDF artifact "${block.props.artifactId}" is missing`);
      }
      return mapArtifact(artifact, block.id);
    },
    clothing: (block) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "clothing") {
        throw new Error(`PDF artifact "${block.props.artifactId}" is missing`);
      }
      return mapArtifact(artifact, block.id);
    },
    prop: (block) => {
      const artifact = options.artifacts?.find(
        (entry) => entry.id === block.props.artifactId,
      );
      if (!artifact || artifact.kind !== "prop") {
        throw new Error(`PDF artifact "${block.props.artifactId}" is missing`);
      }
      return mapArtifact(artifact, block.id);
    },
  });

  type TextInlineParameters = Parameters<
    PreshotReactPdfMappings["inlineContentMapping"]["text"]
  >;
  type LinkInlineParameters = Parameters<
    PreshotReactPdfMappings["inlineContentMapping"]["link"]
  >;
  const inlineContentMapping = {
    ...pdfDefaultSchemaMappings.inlineContentMapping,
    text: (
      content: TextInlineParameters[0],
      exporter: TextInlineParameters[1],
    ) => exporter.transformStyledText(content),
    link: (
      content: LinkInlineParameters[0],
      exporter: LinkInlineParameters[1],
    ) => (
      <Link
        key={`link-${content.href}`}
        href={content.href}
        style={{
          fontFamily: PRESHOT_PDF_FONT_FAMILY,
          fontStyle: "normal",
          color: contract.colors.link,
          textDecoration: "underline",
        }}
      >
        {content.content.map((entry: TextInlineParameters[0]) =>
          exporter.transformStyledText(entry)
        )}
      </Link>
    ),
  } as unknown as PreshotReactPdfMappings["inlineContentMapping"];

  const styleMapping = {
    ...pdfDefaultSchemaMappings.styleMapping,
    bold: (enabled: boolean) => enabled ? { fontWeight: 700 } : {},
    italic: (enabled: boolean) =>
      enabled
        ? {
            fontFamily: PRESHOT_PDF_FONT_FAMILY,
            fontStyle: "normal",
            transform: "skewX(-9deg)",
          }
        : {},
    underline: (enabled: boolean) =>
      enabled ? { textDecoration: "underline" } : {},
    strike: (enabled: boolean) =>
      enabled ? { textDecoration: "line-through" } : {},
    code: (enabled: boolean) =>
      enabled
        ? {
            fontFamily: PRESHOT_PDF_FONT_FAMILY,
            backgroundColor: contract.colors.codeSurface,
          }
        : {},
    textColor: (value: string) => ({
      color: colorValue(String(value ?? ""), "text"),
    }),
    backgroundColor: (value: string) => ({
      backgroundColor: colorValue(
        String(value ?? ""),
        "background",
      ),
    }),
  } as unknown as PreshotReactPdfMappings["styleMapping"];

  return {
    blockMapping,
    inlineContentMapping,
    styleMapping,
  };
}

export class PreshotReactPdfExporter extends PDFExporter<
  PreshotBlockSchema,
  PreshotStyleSchema,
  PreshotInlineContentSchema
> {
  readonly dictionary = editorDictionary();
  private preshotFontsRegistered = false;
  private readonly fontSources: {
    readonly regular: string;
    readonly bold: string;
  };

  constructor(
    readonly context: PreshotContext,
    options: PreshotReactPdfMappingOptions,
  ) {
    super(
      preshotBlockNoteSchema,
      createPreshotReactPdfMappings(context, options),
      {
        colors: COLORS_DEFAULT,
        emojiSource: false,
        resolveFileUrl: createPreshotPdfAssetResolver(context),
      },
    );
    this.fontSources = options.fontSources ?? {
      regular: regularFontUrl,
      bold: boldFontUrl,
    };
    Object.assign(this.styles.page, {
      paddingTop: contract.page.margin,
      paddingBottom:
        contract.page.margin - REACT_PDF_PAGE_ROUNDING_TOLERANCE,
      paddingHorizontal: contract.page.margin,
      fontFamily: PRESHOT_PDF_FONT_FAMILY,
      fontSize: contract.typography.body.fontSize,
      lineHeight:
        contract.typography.body.lineHeight /
        contract.typography.body.fontSize,
      color: contract.colors.ink,
    });
    this.styles.block = { paddingVertical: 0 };
    this.styles.blockChildren = {
      marginLeft: contract.spacing.list.indent,
    };
  }

  override async transformBlocks(
    blocks: Block<
      PreshotBlockSchema,
      PreshotInlineContentSchema,
      PreshotStyleSchema
    >[],
    nestingLevel = 0,
  ): Promise<ReactElement<Text>[]> {
    const transformed: ReactElement<Text>[] = [];
    let numberedListIndex = 0;
    for (const block of blocks) {
      numberedListIndex = block.type === "numberedListItem"
        ? numberedListIndex + 1
        : 0;
      const children = await this.transformBlocks(
        block.children,
        nestingLevel + 1,
      );
      const mapped = await this.mapBlock(
        block as Parameters<PreshotReactPdfExporter["mapBlock"]>[0],
        nestingLevel,
        numberedListIndex,
        children,
      );
      if (
        block.type === "pageBreak" ||
        block.type === "column" || block.type === "columnList" ||
        block.type === "imageGroup"
      ) {
        transformed.push(mapped);
        continue;
      }
      const defaultStyle = this.blocknoteDefaultPropsToReactPDFStyle(
        block.props as Parameters<
          PreshotReactPdfExporter["blocknoteDefaultPropsToReactPDFStyle"]
        >[0],
      );
      transformed.push((
        <Fragment key={block.id}>
          <View
            style={{
              paddingVertical: 2.25,
              ...this.styles.block,
              ...defaultStyle,
            }}
          >
            {mapped}
          </View>
          {children.length > 0
            ? (
                <View
                  key={`${block.id}${nestingLevel}children`}
                  style={{
                    marginLeft: 12,
                    ...this.styles.blockChildren,
                  }}
                >
                  {children}
                </View>
              )
            : null}
        </Fragment>
      ) as ReactElement<Text>);
    }
    return transformed;
  }

  protected override async registerFonts(): Promise<void> {
    if (this.preshotFontsRegistered) return;
    Font.register({
      family: PRESHOT_PDF_FONT_FAMILY,
      src: this.fontSources.regular,
      fontStyle: "normal",
      fontWeight: 400,
    });
    Font.register({
      family: PRESHOT_PDF_FONT_FAMILY,
      src: this.fontSources.bold,
      fontStyle: "normal",
      fontWeight: 700,
    });
    this.preshotFontsRegistered = true;
  }

  override transformStyledText(
    styledText: StyledText<PreshotStyleSchema>,
  ): ReactElement {
    const styles = Object.assign(
      {
        fontFamily: PRESHOT_PDF_FONT_FAMILY,
        fontStyle: "normal",
      },
      ...this.mapStyles(styledText.styles),
    );
    if (styledText.styles.underline && styledText.styles.strike) {
      styles.textDecoration = "underline line-through";
    }
    return (
      <Text hyphenationCallback={pdfWordBreaks} style={styles} key={styledText.text}>
        {styledText.text}
      </Text>
    );
  }

  override async toReactPDFDocument(
    blocks: Block<
      PreshotBlockSchema,
      PreshotInlineContentSchema,
      PreshotStyleSchema
    >[],
  ): Promise<ReactElement> {
    await this.registerFonts();
    return (
      <Document language={uiLocale()}>
        <Page
          dpi={72}
          size={[contract.page.width, contract.page.height]}
          style={this.styles.page}
          wrap
        >
          {await this.transformBlocks(blocks)}
        </Page>
      </Document>
    );
  }
}

export function createPreshotReactPdfExporter(
  context: PreshotContext,
  options: PreshotReactPdfMappingOptions,
): PreshotReactPdfExporter {
  return new PreshotReactPdfExporter(context, options);
}
