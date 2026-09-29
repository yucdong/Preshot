import { resolve } from "node:path";
import { readFileSync } from "node:fs";
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
import { cloneElement, type ReactElement } from "react";
import {
  afterEach,
  afterAll,
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
  createPreshotReactPdfExporter as createPdfExporter,
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

function createPreshotReactPdfExporter(...args: Parameters<typeof createPdfExporter>) {
  return createPdfExporter(args[0], {
    ...args[1],
    fontSources: args[1].fontSources ?? {
      regular: resolve("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
      bold: resolve("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf"),
    },
  });
}

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

interface RenderedPdfNode {
  type: string;
  value?: string;
  box?: { left: number; top: number; width: number; height: number };
  lines?: { box: { width: number } }[];
  children?: RenderedPdfNode[];
}

function renderedNodes(node: RenderedPdfNode): RenderedPdfNode[] {
  return [node, ...(node.children ?? []).flatMap(renderedNodes)];
}

async function renderArtifactLayout(spacerHeight = 0, repetitions = 1) {
  const source = "自备一把透明长柄伞；擦净伞面，半侧身举伞，露出面部。拍摄前检查伞骨，并在安全步道上使用。".repeat(repetitions);
  const artifact = {
    id: "layout-prop", kind: "prop" as const, revision: 0,
    title: "透明伞", source,
    gallery: { id: "layout-gallery", images: [{
      id: "sample", file: "references/sample.png", aspectRatio: 4 / 3,
      sourceWidth: 960, sourceHeight: 720, frameWidth: 300, frameHeight: 225,
    }] },
  };
  const pdf = createPreshotReactPdfExporter(context(), {
    imageGroup: imageGroupMapping, artifacts: [artifact],
    resolvedAssets: { "references/sample.png": `data:image/png;base64,${readFileSync("src-tauri/icons/32x32.png").toString("base64")}` },
    fontSources: {
      regular: resolve("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
      bold: resolve("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf"),
    },
  });
  const document = await pdf.toReactPDFDocument([
    block("prop", { artifactId: artifact.id }, undefined),
  ]);
  const page = childElements(document)[0];
  let layout: RenderedPdfNode | undefined;
  await renderToBuffer(cloneElement(
    document as ReactElement<React.ComponentProps<typeof Document>>,
    { onRender: (data) => { layout = (data as unknown as { _INTERNAL__LAYOUT__DATA_: RenderedPdfNode })._INTERNAL__LAYOUT__DATA_; } },
    cloneElement(page, {}, <View style={{ height: spacerHeight }} />, props(page).children as React.ReactNode),
  ));
  if (!layout) throw new Error("React-PDF did not report its rendered layout");
  return { layout, source };
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
  vi.restoreAllMocks();
});

afterAll(() => Font.reset());

describe("BlockNote React-PDF mappings", () => {
  it("wraps long artifact descriptions inside the text column beside sample images", async () => {
    const { layout, source } = await renderArtifactLayout();
    const metadata = renderedNodes(layout).find((node) =>
      node.type === "TEXT" && node.children?.some((child) => child.value?.replaceAll("\n", "") === source));
    expect(metadata).toBeDefined();
    expect(metadata!.lines!.length).toBeGreaterThan(1);
    for (const line of metadata!.lines!) {
      expect(line.box.width).toBeLessThanOrEqual(metadata!.box!.width + 0.1);
    }
  }, 30_000);

  it("moves a short illustrated card together when the page has insufficient space", async () => {
    const { layout } = await renderArtifactLayout(PDF_VISUAL_CONTRACT.page.contentHeight - 65);
    expect(layout.children).toHaveLength(2);
    const titlePages = layout.children!.map((page, index) =>
      renderedNodes(page).some((node) => node.value === "透明伞") ? index : -1).filter((index) => index >= 0);
    expect(titlePages).toEqual([1]);
    expect(renderedNodes(layout.children![1]).filter((node) => node.type === "IMAGE")).toHaveLength(1);
  }, 30_000);

  it("still paginates illustrated cards with descriptions taller than a page", async () => {
    const { layout } = await renderArtifactLayout(0, 60);
    expect(layout.children!.length).toBeGreaterThan(1);
    const nodes = renderedNodes(layout);
    expect(nodes.filter((node) => node.type === "IMAGE")).toHaveLength(1);
    expect(nodes.reduce((lines, node) => lines + (node.lines?.length ?? 0), 0)).toBeGreaterThan(100);
  }, 30_000);

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

  it("maps optional model additional information", async () => {
    const artifact = {
      id: "model-1",
      kind: "modelCard" as const,
      revision: 0,
      modelId: "林夏",
      heightCm: 168,
      weightKg: 48,
      shoeSize: "38",
      notes: "可自备黑色长靴",
      samples: { id: "model-samples", images: [] },
    };
    const exporter = createPreshotReactPdfExporter(context(), {
      artifacts: [artifact],
      imageGroup: imageGroupMapping,
      resolvedAssets: {},
    });

    const element = await mapBlock(
      exporter,
      block("modelCard", { artifactId: artifact.id }, undefined),
    );
    expect(renderedText(element)).toContain("其他信息：可自备黑色长靴");
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

  it("wraps long mixed Chinese instructions inside the printable width without losing characters", async () => {
    const instructions = "输入 / 插入组件。拖住 block 左侧六点手柄到其他 block 左右边缘即可分栏；拖动栏间分隔线调宽。图片组会等比缩放。单击图片可存入素材库；用图片组的“从素材库插入”选择已有图片。";
    const document = await exporter().toReactPDFDocument([
      block("paragraph", {}, [{ type: "text", text: instructions, styles: {} }]),
    ]);
    type LayoutNode = { children?: LayoutNode[]; lines?: { string: string; xAdvance: number }[] };
    let layout: LayoutNode | undefined;
    await renderToBuffer(cloneElement(document as ReactElement<React.ComponentProps<typeof Document>>, {
      onRender: result => { layout = (result as unknown as { _INTERNAL__LAYOUT__DATA_: LayoutNode })._INTERNAL__LAYOUT__DATA_; },
    }));
    const lines: { string: string; xAdvance: number }[] = [];
    const visit = (node: LayoutNode) => {
      if (node.lines) lines.push(...node.lines);
      node.children?.forEach(visit);
    };
    visit(layout!);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.xAdvance).toBeLessThanOrEqual(PDF_VISUAL_CONTRACT.page.contentWidth + 0.1);
    expect(lines.map(line => line.string).join("").replace(/\s/g, "")).toBe(instructions.replace(/\s/g, ""));
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
