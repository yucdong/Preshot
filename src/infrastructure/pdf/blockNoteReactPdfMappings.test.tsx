import { resolve } from "node:path";
import {
  Document,
  Font,
  Image,
  Link,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { zh } from "@blocknote/core/locales";
import type { ReactElement } from "react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PreshotPdfExportContext } from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteSchema,
  type PreshotEditorBlock,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import {
  PRESHOT_PDF_FONT_FAMILY,
  PRESHOT_PDF_DICTIONARY,
  createPreshotPdfAssetResolver,
  createPreshotReactPdfExporter,
  createPreshotReactPdfMappings,
  type PreshotImageGroupPdfMapping,
} from "./blockNoteReactPdfMappings";

type Context = PreshotPdfExportContext<PreshotBlockNoteSchema>;
type ElementProps = Record<string, unknown> & {
  children?: unknown;
  style?: Record<string, unknown>;
};

const imageGroupMapping: PreshotImageGroupPdfMapping = (block) =>
  <View key={`image-group-${block.id}`} wrap={false} />;

function block(
  type: PreshotEditorBlock["type"],
  props: Record<string, boolean | number | string> = {},
  content: unknown = [],
  children: PreshotEditorBlock[] = [],
): PreshotEditorBlock {
  return {
    id: `${type}-id`,
    type,
    props,
    content,
    children,
  } as unknown as PreshotEditorBlock;
}

function context(
  overrides: Partial<Context> = {},
): Context {
  return {
    version: 3,
    schema: preshotBlockNoteSchema,
    blocks: [],
    blocksById: {},
    columnLists: [],
    groups: [],
    groupsByBlockId: {},
    groupsByGroupId: {},
    nativeImagesByBlockId: {},
    assetRequests: [],
    assets: [],
    assetsById: {},
    page: PDF_VISUAL_CONTRACT.page,
    typography: PDF_VISUAL_CONTRACT.typography,
    spacing: PDF_VISUAL_CONTRACT.spacing,
    colors: PDF_VISUAL_CONTRACT.colors,
    borders: PDF_VISUAL_CONTRACT.borders,
    warnings: [],
    fatalErrors: [],
    ...overrides,
  } as Context;
}

function props(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function childElements(element: ReactElement): ReactElement[] {
  const value = props(element).children;
  const flatten = (entry: unknown): ReactElement[] => {
    if (Array.isArray(entry)) return entry.flatMap(flatten);
    return typeof entry === "object" && entry !== null && "props" in entry
      ? [entry as ReactElement]
      : [];
  };
  return flatten(value);
}

function style(element: ReactElement): Record<string, unknown> {
  return props(element).style ?? {};
}

function renderedText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) return value.map(renderedText).join("");
  if (typeof value !== "object" || value === null || !("props" in value)) {
    return "";
  }
  return renderedText(props(value as ReactElement).children);
}

function allDescendants(element: ReactElement): ReactElement[] {
  return [
    element,
    ...childElements(element).flatMap(allDescendants),
  ];
}

function exporter(currentContext = context()) {
  return createPreshotReactPdfExporter(currentContext, {
    imageGroup: imageGroupMapping,
  });
}

async function mapBlock(
  pdf: ReturnType<typeof exporter>,
  value: PreshotEditorBlock,
  _nestingLevel = 0,
  numberedListIndex = 0,
  children: ReactElement[] = [],
) {
  return pdf.mapBlock(
    value as never,
    0,
    numberedListIndex,
    children as never,
  );
}

afterEach(() => {
  Font.reset();
  vi.restoreAllMocks();
});

describe("BlockNote React-PDF mappings", () => {
  it("composes the official mappings and covers every shared block", () => {
    const mappings = createPreshotReactPdfMappings(context(), {
      imageGroup: imageGroupMapping,
    });

    expect(Object.keys(mappings.blockMapping).sort()).toEqual(
      Object.keys(preshotBlockNoteSchema.blockSpecs).sort(),
    );
    expect(Object.keys(mappings.inlineContentMapping).sort()).toEqual([
      "link",
      "text",
    ]);
    expect(Object.keys(mappings.styleMapping).sort()).toEqual(
      Object.keys(preshotBlockNoteSchema.styleSpecs).sort(),
    );
  });

  it("maps H1-H6 to the visual-contract sizes", async () => {
    const pdf = exporter();
    const sizes = [];
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const element = await mapBlock(pdf, 
        block("heading", {
          level,
          textAlignment: "left",
          textColor: "default",
          backgroundColor: "default",
        }, [{ type: "text", text: `H${level}`, styles: {} }]),
        0,
        0,
      );
      sizes.push(style(element).fontSize);
    }

    expect(sizes).toEqual(
      Object.values(PDF_VISUAL_CONTRACT.typography.headings).map(
        (heading) => heading.fontSize,
      ),
    );
  });

  it("maps artifact metadata and omits an empty source note", async () => {
    const base = {
      id: "prop-1",
      kind: "prop" as const,
      revision: 0,
      title: "磨砂铝反光板",
      gallery: { id: "prop-gallery", images: [] },
    };
    const emptySource = createPreshotReactPdfExporter(context(), {
      artifacts: [{ ...base, source: "" }],
      imageGroup: imageGroupMapping,
      resolvedAssets: {},
    });

    const emptyElement = await mapBlock(
      emptySource,
      block("prop", { artifactId: base.id }, undefined),
    );
    expect(renderedText(emptyElement)).toContain("磨砂铝反光板");
    expect(renderedText(emptyElement)).not.toContain("来源说明");

    const withSource = createPreshotReactPdfExporter(context(), {
      artifacts: [{ ...base, source: "Studio Supply / 徐汇仓" }],
      imageGroup: imageGroupMapping,
      resolvedAssets: {},
    });
    const sourceElement = await mapBlock(
      withSource,
      block("prop", { artifactId: base.id }, undefined),
    );
    expect(renderedText(sourceElement)).toContain("Studio Supply / 徐汇仓");
    expect(renderedText(sourceElement)).not.toContain("来源说明：");
  });

  it("uses persisted crop and manual frame geometry", async () => {
    const artifact = {
      id: "prop-crop",
      kind: "prop" as const,
      revision: 0,
      title: "Cropped prop",
      source: "",
      gallery: {
        id: "prop-gallery",
        images: [{
          id: "image-1",
          file: "references/prop.png",
          aspectRatio: 1.5,
          sourceWidth: 900,
          sourceHeight: 600,
          frameWidth: 300,
          frameHeight: 240,
          frameOffsetX: 20,
          frameOffsetY: 12,
          crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.5 },
        }],
      },
    };
    const pdf = createPreshotReactPdfExporter(context(), {
      artifacts: [artifact],
      imageGroup: imageGroupMapping,
      resolvedAssets: {
        "references/prop.png": "data:image/png;base64,AA==",
      },
    });
    const element = await mapBlock(
      pdf,
      block("prop", { artifactId: artifact.id }, undefined),
    );
    const styles = allDescendants(element).map(style);
    expect(styles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        position: "absolute",
        width: "200%",
        height: "200%",
        left: "-40%",
        top: "-20%",
      }),
      expect.objectContaining({
        position: "absolute",
        overflow: "hidden",
      }),
    ]));
    const cropFrame = styles.find((entry) => entry.overflow === "hidden");
    expect(Number(cropFrame?.left)).toBeGreaterThanOrEqual(0);
    expect(Number(cropFrame?.top)).toBeGreaterThanOrEqual(0);
    expect(Number(cropFrame?.width) / Number(cropFrame?.height))
      .toBeCloseTo(
        artifact.gallery.images[0].frameWidth /
          artifact.gallery.images[0].frameHeight,
        5,
      );
  });

  it("preserves inline emphasis, combined decoration, colors, code, and alignment", async () => {
    const pdf = exporter();
    const styled = pdf.transformStyledText({
      type: "text",
      text: "格式",
      styles: {
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        code: true,
        textColor: "#123456",
        backgroundColor: "yellow",
      } as never,
    });
    const paragraph = await mapBlock(pdf, 
      block("paragraph", {
        textAlignment: "center",
        textColor: "default",
        backgroundColor: "default",
      }, [{ type: "text", text: "居中", styles: {} }]),
      0,
      0,
    );

    expect(style(styled)).toMatchObject({
      fontFamily: PRESHOT_PDF_FONT_FAMILY,
      fontStyle: "normal",
      fontWeight: 700,
      transform: "skewX(-9deg)",
      textDecoration: "underline line-through",
      color: "#123456",
      backgroundColor: "#fbf3db",
    });
    expect(style(paragraph).textAlign).toBe("center");
  });

  it("maps lists, quote, code, divider, and page break semantically", async () => {
    const pdf = exporter();
    const text = [{ type: "text", text: "项目", styles: {} }];
    const cases = [
      ["bulletListItem", {}, "•"],
      ["numberedListItem", {}, "3."],
      ["checkListItem", { checked: true }, "☒"],
      ["toggleListItem", {}, "▸"],
    ] as const;

    for (const [type, blockProps, marker] of cases) {
      const element = await mapBlock(pdf, 
        block(type, {
          textAlignment: "left",
          textColor: "default",
          backgroundColor: "default",
          ...blockProps,
        }, text),
        0,
        3,
      );
      const markerText = childElements(element)[0];
      expect(props(markerText).children).toBe(marker);
    }

    const quote = await mapBlock(pdf, 
      block("quote", {
        textAlignment: "left",
        textColor: "default",
        backgroundColor: "default",
      }, text),
      0,
      0,
    );
    const code = await mapBlock(pdf, 
      block("codeBlock", { language: "text" }, [
        { type: "text", text: "const 值 = 1;\n  值++;", styles: {} },
      ]),
      0,
      0,
    );
    const divider = await mapBlock(pdf, block("divider"), 0, 0);
    const pageBreak = await mapBlock(pdf, block("pageBreak"), 0, 0);

    expect(style(quote)).toMatchObject({
      borderLeftWidth: PDF_VISUAL_CONTRACT.borders.quote,
      borderLeftColor: PDF_VISUAL_CONTRACT.colors.quoteBorder,
    });
    expect(style(code)).toMatchObject({
      backgroundColor: PDF_VISUAL_CONTRACT.colors.codeSurface,
    });
    expect(style(divider).borderTopWidth).toBe(
      PDF_VISUAL_CONTRACT.borders.hairline,
    );
    expect(props(pageBreak).break).toBe(true);
  });

  it("keeps table rows together and preserves headers, widths, colors, and alignment", async () => {
    const pdf = exporter();
    const table = await mapBlock(pdf, 
      block("table", {}, {
        type: "tableContent",
        columnWidths: [2, 1],
        headerRows: 1,
        headerCols: 0,
        rows: [{
          cells: [
            [{
              type: "text",
              text: "标题",
              styles: { bold: true },
            }],
            [{
              type: "text",
              text: "值",
              styles: {},
            }],
          ],
        }],
      }),
      0,
      0,
    );
    const row = childElements(table)[0];
    const cells = childElements(row);

    expect(props(row).wrap).toBe(false);
    expect(style(cells[0])).toMatchObject({
      flexGrow: 2,
      backgroundColor: PDF_VISUAL_CONTRACT.colors.softSurface,
    });
    expect(style(cells[1]).flexGrow).toBe(1);
    expect(style(childElements(cells[0])[0]).fontWeight).toBe(700);
  });

  it("creates PDF link annotations and contextual media fallbacks", async () => {
    const pdf = exporter();
    const link = pdf.mapInlineContent({
      type: "link",
      href: "https://example.com/素材",
      content: [{ type: "text", text: "打开素材", styles: {} }],
    });
    const video = await mapBlock(pdf, 
      block("video", {
        url: "https://example.com/video",
        name: "访谈",
        caption: "",
        showPreview: true,
        previewWidth: 320,
      }),
      0,
      0,
    );
    const audio = await mapBlock(pdf, 
      block("audio", {
        url: "media/audio.wav",
        name: "现场声",
        caption: "",
        showPreview: false,
      }),
      0,
      0,
    );
    const file = await mapBlock(pdf, 
      block("file", {
        url: "",
        name: "",
        caption: "",
        showPreview: false,
      }),
      0,
      0,
    );

    expect(link.type).toBe(Link);
    expect(props(link).href).toBe("https://example.com/素材");
    expect(childElements(video)[0].type).toBe(Link);
    expect(JSON.stringify(props(audio).children)).toContain(
      "项目本地资源：media/audio.wav",
    );
    expect(JSON.stringify(props(file).children)).toContain("未附加源文件");
  });

  it("uses only preflight assets for native images and never falls back to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const currentContext = context({
      assets: [{
        assetId: "asset-1",
        cacheKey: "media/photo.png",
        source: "media/photo.png",
        crop: { x: 0, y: 0, width: 1, height: 1 },
        drawBox: { width: 120, height: 80 },
        dpi: 144,
        mime: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
        uses: [],
      }],
      nativeImagesByBlockId: {
        "image-id": {
          blockId: "image-id",
          source: "media/photo.png",
          assetId: "asset-1",
          logicalWidth: 120,
          logicalHeight: 80,
          pdfWidth: 120,
          pdfHeight: 80,
          blockWidth: 300,
          captionWidth: 300,
          captionLines: ["本地", "照片"],
          captionHeight: 28.245,
          blockSpacing: PDF_VISUAL_CONTRACT.spacing.nativeImage.after,
          blockHeight: 114.245,
          keepTogether: {
            enabled: true,
            moveToNextPageIfNeeded: true,
          },
        },
      },
    } as unknown as Partial<Context>);
    const resolver = createPreshotPdfAssetResolver(currentContext);
    const blob = await resolver("media/photo.png");
    const image = await mapBlock(exporter(currentContext), 
      block("image", {
        url: "media/photo.png",
        name: "照片",
        caption: "本地照片",
        showPreview: true,
        previewWidth: 120,
      }),
      0,
      0,
    );

    expect(blob.type).toBe("image/png");
    const mappedImage = childElements(image)[0];
    expect(mappedImage.type).toBe(Image);
    expect(props(image).wrap).toBe(false);
    expect(style(image)).toMatchObject({
      width: 300,
      marginBottom: PDF_VISUAL_CONTRACT.spacing.nativeImage.after,
    });
    expect(style(mappedImage)).toMatchObject({
      width: 120,
      height: 80,
      alignSelf: "center",
    });
    expect(style(childElements(image)[1]).width).toBe(300);
    expect(props(childElements(image)[1]).children).toBe("本地\n照片");
    expect(
      Number(style(mappedImage).height) +
        Number(currentContext.nativeImagesByBlockId["image-id"].captionHeight) +
        Number(style(image).marginBottom),
    ).toBeLessThanOrEqual(PDF_VISUAL_CONTRACT.page.contentHeight);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(resolver("https://example.com/image.png")).rejects.toThrow(
      "project-local resolver",
    );
  });

  it("preserves column weights and gaps while leaving rows breakable", async () => {
    const pdf = exporter();
    const left = await mapBlock(pdf, 
      block("column", { width: 0.75 }),
      0,
      0,
      [],
    );
    const right = await mapBlock(pdf, 
      block("column", { width: 1.25 }),
      0,
      0,
      [],
    );
    const row = await mapBlock(pdf, 
      block("columnList"),
      0,
      0,
      [left, right],
    );

    expect(style(left).flexGrow).toBe(0.75);
    expect(style(right).flexGrow).toBe(1.25);
    expect(style(row).gap).toBe(PDF_VISUAL_CONTRACT.columns.gap);
    expect(props(row).wrap).toBe(true);
  });

  it("registers only bundled upright Noto Sans SC regular and bold faces", async () => {
    const register = vi.spyOn(Font, "register").mockImplementation(() => {});
    const pdf = exporter();

    await pdf.toReactPDFDocument([]);

    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls.map(([font]) => font)).toEqual([
      expect.objectContaining({
        family: PRESHOT_PDF_FONT_FAMILY,
        fontStyle: "normal",
        fontWeight: 400,
      }),
      expect.objectContaining({
        family: PRESHOT_PDF_FONT_FAMILY,
        fontStyle: "normal",
        fontWeight: 700,
      }),
    ]);
    expect(register.mock.calls.some(([font]) =>
      "fontStyle" in font && font.fontStyle === "italic"
    )).toBe(false);
    expect(pdf.options.emojiSource).toBe(false);
    expect(pdf.dictionary).toBe(zh);
    expect(PRESHOT_PDF_DICTIONARY).toBe(zh);
  });

  it("renders CJK and a real PDF link annotation with local fonts", async () => {
    const pdf = createPreshotReactPdfExporter(context(), {
      imageGroup: imageGroupMapping,
      fontSources: {
        regular: resolve(
          "src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf",
        ),
        bold: resolve(
          "src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf",
        ),
      },
    });
    const document = await pdf.toReactPDFDocument([
      block("heading", {
        level: 1,
        textAlignment: "left",
        textColor: "default",
        backgroundColor: "default",
      }, [{ type: "text", text: "拍摄计划", styles: { bold: true } }]),
      block("paragraph", {
        textAlignment: "left",
        textColor: "default",
        backgroundColor: "default",
      }, [{
        type: "link",
        href: "https://example.com/reference",
        content: [{ type: "text", text: "打开参考资料", styles: {} }],
      }]),
    ]);
    const output = await renderToBuffer(
      document as ReactElement<React.ComponentProps<typeof Document>>,
    ) as unknown;
    const bytes = Buffer.isBuffer(output)
      ? output
      : await new Promise<Buffer>((resolveBuffer, rejectBuffer) => {
          const chunks: Buffer[] = [];
          const stream = output as NodeJS.ReadableStream;
          stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on("end", () => resolveBuffer(Buffer.concat(chunks)));
          stream.on("error", rejectBuffer);
        });
    const parsed = await PDFDocument.load(new Uint8Array(bytes));
    const annotations = parsed.getPages()[0].node.Annots();

    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(annotations?.size()).toBe(1);
  }, 30_000);
});
