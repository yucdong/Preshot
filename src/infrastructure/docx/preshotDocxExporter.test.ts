// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { Paragraph } from "docx";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "../../domain/plan/canvas/blockDocument";
import {
  preshotBlockNoteSchema,
  type PreshotBlockSchema,
  type PreshotInlineContentSchema,
  type PreshotStyleSchema,
} from "../../features/plan/blocknote/preshotBlockNoteSchema";
import {
  docxXml,
  unzipDocx,
  wordAttribute,
  xmlElements,
} from "../../../e2e/docxTestArchive";
import {
  PRESHOT_DOCX_A4,
  PRESHOT_DOCX_COLUMN_GAP_TWIPS,
  createPreshotDocxExporter,
} from "./preshotDocxExporter";

const TEST_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAYAAAB4ka1VAAAAE0lEQVR4nGO4dvnif3yYYRAoAAC9iYrpFnTwwwAAAABJRU5ErkJggg==";

function pngDataUrl(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return `data:image/png;base64,${
    btoa(String.fromCharCode(...bytes))
  }`;
}

type PreshotPartialBlock = PartialBlock<
  PreshotBlockSchema,
  PreshotInlineContentSchema,
  PreshotStyleSchema
>;

function editorBlocks(content: PreshotPartialBlock[]) {
  return BlockNoteEditor.create({
    schema: preshotBlockNoteSchema,
    initialContent: content,
  }).document;
}

function imageGroupFallback() {
  return new Paragraph({ text: "[参考图片组需要自定义 DOCX 映射]" });
}

async function exportArchive(
  content: PreshotPartialBlock[],
  assets: Readonly<Record<string, Blob | string>> = {},
  artifacts: readonly ArtifactRecord[] = [],
) {
  const exporter = createPreshotDocxExporter({
    artifacts,
    imageGroupMapping: imageGroupFallback,
  });
  const blob = await exporter.export(editorBlocks(content), { assets });
  const entries = await unzipDocx(blob);
  return {
    blob,
    entries,
    document: docxXml(entries, "word/document.xml"),
    styles: docxXml(entries, "word/styles.xml"),
    core: docxXml(entries, "docProps/core.xml"),
  };
}

function values(document: XMLDocument, localName: string): string[] {
  return xmlElements(document, localName)
    .map((element) => wordAttribute(element, "val"))
    .filter((value): value is string => value !== null);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function listLevels(document: XMLDocument): ReadonlyMap<string, number> {
  return new Map(
    xmlElements(document, "p").flatMap((paragraph) => {
      const level = xmlElements(paragraph, "ilvl")[0];
      if (!level) return [];
      const value = wordAttribute(level, "val");
      if (value === null) return [];
      const text = xmlElements(paragraph, "t")
        .map((node) => node.textContent ?? "")
        .join("");
      return [[text, Number(value)] as const];
    }),
  );
}

describe("Preshot DOCX exporter", () => {
  it("exports artifact text while omitting an empty source note", async () => {
    const base = {
      id: "prop-1",
      kind: "prop" as const,
      revision: 0,
      title: "磨砂铝反光板",
      gallery: { id: "prop-gallery", images: [] },
    };
    const empty = await exportArchive(
      [{ type: "prop", props: { artifactId: base.id } }],
      {},
      [{ ...base, source: "" }],
    );
    expect(empty.document.text).toContain("磨砂铝反光板");
    expect(empty.document.text).not.toContain("来源说明");

    const populated = await exportArchive(
      [{ type: "prop", props: { artifactId: base.id } }],
      {},
      [{ ...base, source: "Studio Supply / 徐汇仓" }],
    );
    expect(populated.document.text).toContain("Studio Supply / 徐汇仓");
    expect(populated.document.text).not.toContain("来源说明：");
  });

  it("uses the exact shared schema and preserves editable text plus H1-H6", async () => {
    const exporter = createPreshotDocxExporter({
      imageGroupMapping: imageGroupFallback,
    });
    expect(exporter.schema).toBe(preshotBlockNoteSchema);

    const headings = Array.from({ length: 6 }, (_, index) => ({
      type: "heading" as const,
      props: { level: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 },
      content: `标题 ${index + 1}`,
    }));
    const { document } = await exportArchive([
      { type: "paragraph", content: "普通中文可编辑段落" },
      ...headings,
    ]);

    expect(document.text).toContain("普通中文可编辑段落");
    expect(values(document.document, "pStyle")).toEqual(
      expect.arrayContaining(
        Array.from({ length: 6 }, (_, index) => `Heading${index + 1}`),
      ),
    );
  });

  it("preserves top-level and true nested list levels 0-8", async () => {
    const nested = (
      depth: number,
      type: "bulletListItem" | "numberedListItem",
    ): PreshotPartialBlock => ({
      type,
      content: `${type}-${depth}`,
      children: depth === 8 ? [] : [nested(depth + 1, type)],
    });
    const { document } = await exportArchive([
      nested(0, "bulletListItem"),
      nested(0, "numberedListItem"),
      { type: "checkListItem", props: { checked: true }, content: "已完成" },
      { type: "toggleListItem", content: "折叠内容" },
    ]);

    const levels = listLevels(document.document);
    expect(levels.get("bulletListItem-0")).toBe(0);
    expect(levels.get("bulletListItem-8")).toBe(8);
    expect(levels.get("numberedListItem-0")).toBe(0);
    expect(levels.get("numberedListItem-8")).toBe(8);
    expect(document.text).toContain("已完成");
    expect(document.text).toContain("折叠内容");
  });

  it("rejects Word list level 9 instead of clamping it", async () => {
    const tooDeep = (
      depth: number,
    ): PreshotPartialBlock => ({
      type: "bulletListItem",
      content: `too-deep-${depth}`,
      children: depth === 9 ? [] : [tooDeep(depth + 1)],
    });
    const exporter = createPreshotDocxExporter({
      imageGroupMapping: imageGroupFallback,
    });
    await expect(exporter.export(editorBlocks([tooDeep(0)]))).rejects.toThrow(
      /level 9/i,
    );
  });

  it.each([2, 3])(
    "keeps top-level lists in %i columns at Word level 0",
    async (columnCount) => {
      const { document } = await exportArchive([{
        type: "columnList",
        children: Array.from({ length: columnCount }, (_, index) => ({
          type: "column" as const,
          props: { width: 1 },
          children: [{
            type: index % 2 === 0
              ? "bulletListItem" as const
              : "numberedListItem" as const,
            content: `column-${columnCount}-${index}`,
          }],
        })),
      }]);

      const levels = listLevels(document.document);
      for (let index = 0; index < columnCount; index += 1) {
        expect(levels.get(`column-${columnCount}-${index}`)).toBe(0);
      }
    },
  );

  it("preserves true nested lists inside columns and resets each column", async () => {
    const { document } = await exportArchive([{
      type: "columnList",
      children: [
        {
          type: "column",
          props: { width: 1 },
          children: [{
            type: "bulletListItem",
            content: "left-0",
            children: [{
              type: "numberedListItem",
              content: "left-1",
              children: [{
                type: "bulletListItem",
                content: "left-2",
              }],
            }],
          }],
        },
        {
          type: "column",
          props: { width: 1 },
          children: [{
            type: "numberedListItem",
            content: "right-0",
          }],
        },
      ],
    }]);

    expect(Object.fromEntries(listLevels(document.document))).toMatchObject({
      "left-0": 0,
      "left-1": 1,
      "left-2": 2,
      "right-0": 0,
    });
  });

  it("ignores non-list structure and resets list context across a column boundary", async () => {
    const { document } = await exportArchive([{
      type: "bulletListItem",
      content: "outer-list",
      children: [{
        type: "paragraph",
        content: "structural-wrapper",
        children: [{
          type: "numberedListItem",
          content: "nested-through-paragraph",
          children: [{
            type: "columnList",
            children: [
              {
                type: "column",
                props: { width: 1 },
                children: [{
                  type: "paragraph",
                  content: "column-wrapper",
                  children: [{
                    type: "bulletListItem",
                    content: "reset-in-column",
                  }],
                }],
              },
              {
                type: "column",
                props: { width: 1 },
                children: [{
                  type: "numberedListItem",
                  content: "reset-in-sibling-column",
                }],
              },
            ],
          }],
        }],
      }],
    }]);

    expect(Object.fromEntries(listLevels(document.document))).toMatchObject({
      "outer-list": 0,
      "nested-through-paragraph": 1,
      "reset-in-column": 0,
      "reset-in-sibling-column": 0,
    });
  });

  it("maps quote, code, divider, page break, and editable table content", async () => {
    const { document } = await exportArchive([
      { type: "quote", content: "引用内容" },
      { type: "codeBlock", content: "const value = 1;\nreturn value;" },
      { type: "divider" },
      { type: "pageBreak" },
      {
        type: "table",
        content: {
          type: "tableContent",
          columnWidths: [120, 180],
          rows: [{
            cells: [
              ["表格甲"],
              ["表格乙"],
            ],
          }],
        },
      },
    ]);

    expect(values(document.document, "pStyle")).toEqual(
      expect.arrayContaining(["BlockQuote", "SourceCode"]),
    );
    expect(xmlElements(document.document, "br").some(
      (element) => wordAttribute(element, "type") === "page",
    )).toBe(true);
    expect(xmlElements(document.document, "tbl")).toHaveLength(1);
    expect(document.text).toContain("表格甲");
    expect(document.text).toContain("表格乙");
  });

  it("preserves links, inline styles, named colors, and alignment", async () => {
    const styledParagraph = {
      type: "paragraph",
      props: {
        textAlignment: "center",
        textColor: "red",
        backgroundColor: "yellow",
      },
      content: [
        {
          type: "text",
          text: "样式",
          styles: {
            bold: true,
            italic: true,
            underline: true,
            strike: true,
            code: true,
            textColor: "blue",
            backgroundColor: "green",
          },
        },
        {
          type: "link",
          href: "https://example.com/plan",
          content: [{ type: "text", text: "链接", styles: {} }],
        },
      ],
    } as unknown as PreshotPartialBlock;
    const { document } = await exportArchive([styledParagraph]);

    expect(values(document.document, "jc")).toContain("center");
    expect(xmlElements(document.document, "b").length).toBeGreaterThan(0);
    expect(xmlElements(document.document, "i").length).toBeGreaterThan(0);
    expect(xmlElements(document.document, "u").length).toBeGreaterThan(0);
    expect(xmlElements(document.document, "strike").length).toBeGreaterThan(0);
    expect(xmlElements(document.document, "shd").length).toBeGreaterThan(0);
    expect(xmlElements(document.document, "color").length).toBeGreaterThan(0);
    expect(xmlElements(document.document, "hyperlink").length).toBe(1);
  });

  it("embeds native local images with aspect ratio, caption, and alt text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const source = "media/native.png";
    const { entries, document } = await exportArchive([{
      type: "image",
      props: {
        url: source,
        name: "构图参考",
        caption: "八比五构图",
        previewWidth: 320,
      },
    }], {
      [source]: TEST_PNG,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect([...entries.keys()].some((name) => name.startsWith("word/media/")))
      .toBe(true);
    expect(document.text).toContain("八比五构图");
    expect(document.text).not.toContain(source);
    const extent = xmlElements(document.document, "extent")[0]!;
    const width = Number(extent.getAttribute("cx"));
    const height = Number(extent.getAttribute("cy"));
    expect(width / height).toBeCloseTo(8 / 5, 3);
    expect(width / 9_525).toBeCloseTo(320, 3);
    const docProperties = xmlElements(document.document, "docPr")[0]!;
    expect(docProperties.getAttribute("descr")).toBe("八比五构图");
    expect(docProperties.getAttribute("title")).toBe("八比五构图");
  });

    it("transcodes local WebP to PNG without network before embedding", async () => {
      const source = "media/native.webp";
      const webp = Uint8Array.from([
        82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80,
      ]);
      const bitmap = { width: 8, height: 5, close: vi.fn() };
      vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tagName) => {
        if (tagName !== "canvas") return originalCreateElement(tagName);
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: BlobCallback) =>
            callback(new Blob([
              Uint8Array.from(atob(TEST_PNG.split(",")[1]!), (value) =>
                value.charCodeAt(0)),
            ], { type: "image/png" })),
        } as unknown as HTMLCanvasElement;
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const { entries } = await exportArchive([{
        type: "image",
        props: { url: source, name: "WebP", caption: "", previewWidth: 320 },
      }], {
        [source]: `data:image/webp;base64,${
          btoa(String.fromCharCode(...webp))
        }`,
      });

      expect([...entries.keys()].some((name) => name.endsWith(".png"))).toBe(
        true,
      );
      expect(bitmap.close).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fits a 1:10 native image by page height and reserves wrapped caption height", async () => {
      const source = "media/tall.png";
      const withoutCaption = await exportArchive([{
        type: "image",
        props: { url: source, name: "Tall", caption: "", previewWidth: 500 },
      }], { [source]: pngDataUrl(100, 1_000) });
      const caption = "很长的确定性说明文字".repeat(80);
      const withCaption = await exportArchive([{
        type: "image",
        props: { url: source, name: "Tall", caption, previewWidth: 500 },
      }], { [source]: pngDataUrl(100, 1_000) });
      const extent = (archive: Awaited<ReturnType<typeof exportArchive>>) => {
        const element = xmlElements(archive.document.document, "extent")[0]!;
        return {
          width: Number(element.getAttribute("cx")) / 9_525,
          height: Number(element.getAttribute("cy")) / 9_525,
        };
      };
      const plain = extent(withoutCaption);
      const wrapped = extent(withCaption);

      expect(plain.width / plain.height).toBeCloseTo(0.1, 3);
      expect(wrapped.width / wrapped.height).toBeCloseTo(0.1, 3);
      expect(wrapped.height).toBeLessThan(plain.height);
      expect(wrapped.height).toBeLessThan(
        PRESHOT_DOCX_A4.contentHeightTwips / 15,
      );
      expect(withCaption.document.text).toContain(caption);
    });

    it("fits native images to their weighted column width without overflow", async () => {
      const source = "media/wide.png";
      const { document } = await exportArchive([{
        type: "columnList",
        children: [
          {
            type: "column",
            props: { width: 1 },
            children: [{
              type: "image",
              props: {
                url: source,
                name: "Wide",
                caption: "",
                previewWidth: 1_000,
              },
            }],
          },
          {
            type: "column",
            props: { width: 1 },
            children: [{ type: "paragraph", content: "copy" }],
          },
        ],
      }], { [source]: pngDataUrl(1_000, 100) });
      const extent = xmlElements(document.document, "extent")[0]!;
      const widthPixels = Number(extent.getAttribute("cx")) / 9_525;
      const available =
        PRESHOT_DOCX_A4.contentWidthTwips - PRESHOT_DOCX_COLUMN_GAP_TWIPS;

      expect(widthPixels).toBeLessThanOrEqual(available / 2 / 15);
    });

  it("uses contextual media hyperlinks and path-free local fallbacks", async () => {
    const { entries, document } = await exportArchive([
      {
        type: "audio",
        props: {
          url: "https://example.com/audio.mp3",
          name: "环境声",
          caption: "现场收音",
        },
      },
      {
        type: "video",
        props: {
          url: "media/private-video.mp4",
          name: "机位视频",
          caption: "",
        },
      },
      {
        type: "file",
        props: {
          url: "",
          name: "拍摄清单",
          caption: "",
        },
      },
    ]);

    const relationships = docxXml(
      entries,
      "word/_rels/document.xml.rels",
    ).text;
    expect(document.text).toContain("音频：环境声");
    expect(document.text).toContain("现场收音");
    expect(document.text).toContain("视频：机位视频（项目本地资源，未嵌入）");
    expect(document.text).toContain("文件：拍摄清单（未附加源文件）");
    expect(relationships).toContain("https://example.com/audio.mp3");
    expect(document.text + relationships).not.toContain(
      "media/private-video.mp4",
    );
  });

  it("uses fixed borderless weighted columns with exact A4-body twips", async () => {
    const { document } = await exportArchive([{
      type: "columnList",
      children: [
        {
          type: "column",
          props: { width: 1 },
          children: [{
            type: "paragraph",
            content: "一段很长的文字 ".repeat(200),
          }],
        },
        {
          type: "column",
          props: { width: 2 },
          children: [{ type: "divider" }],
        },
      ],
    }]);

    expect(xmlElements(document.document, "tblLayout").map(
      (element) => wordAttribute(element, "type"),
    )).toContain("fixed");
    const gridWidths = xmlElements(document.document, "gridCol").map(
      (element) => Number(wordAttribute(element, "w")),
    );
    const available =
      PRESHOT_DOCX_A4.contentWidthTwips - PRESHOT_DOCX_COLUMN_GAP_TWIPS;
    expect(gridWidths).toEqual([
      Math.floor(available / 3),
      PRESHOT_DOCX_COLUMN_GAP_TWIPS,
      available - Math.floor(available / 3),
    ]);
    const borderValues = [
      "top",
      "bottom",
      "left",
      "right",
      "insideH",
      "insideV",
    ].flatMap((name) =>
      xmlElements(document.document, name).map(
        (element) => wordAttribute(element, "val"),
      )
    );
    expect(borderValues).toContain("nil");
    expect(xmlElements(document.document, "cantSplit")).toHaveLength(0);
  });

  it("uses cantSplit only for known short all-atomic column rows", async () => {
    const { document } = await exportArchive([{
      type: "columnList",
      children: [
        {
          type: "column",
          props: { width: 1 },
          children: [{ type: "divider" }],
        },
        {
          type: "column",
          props: { width: 1 },
          children: [{
            type: "file",
            props: { url: "", name: "清单", caption: "" },
          }],
        },
      ],
    }]);

    expect(xmlElements(document.document, "cantSplit")).toHaveLength(1);
  });

  it("configures A4 portrait, 24pt margins, and Chinese metadata/locale", async () => {
    const { document, styles, core } = await exportArchive([
      { type: "paragraph", content: "分页由 Word 字体回退决定" },
    ]);
    const pageSize = xmlElements(document.document, "pgSz")[0]!;
    const pageMargin = xmlElements(document.document, "pgMar")[0]!;

    expect(wordAttribute(pageSize, "w")).toBe(
      String(PRESHOT_DOCX_A4.widthTwips),
    );
    expect(wordAttribute(pageSize, "h")).toBe(
      String(PRESHOT_DOCX_A4.heightTwips),
    );
    expect(wordAttribute(pageSize, "orient")).toBe("portrait");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(wordAttribute(pageMargin, side)).toBe("480");
    }
    expect(styles.text).toContain('w:val="zh-CN"');
    expect(core.text).toContain("Preshot 摄影计划");
    expect(core.text).toContain("摄影计划");
  });

  it("never uses a hosted proxy or network for native images", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const exporter = createPreshotDocxExporter({
      imageGroupMapping: imageGroupFallback,
    });

    await expect(exporter.export(editorBlocks([{
      type: "image",
      props: {
        url: "https://example.com/private.png",
        name: "远程图片",
        caption: "",
      },
    }]))).rejects.toThrow(/local project image data/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
