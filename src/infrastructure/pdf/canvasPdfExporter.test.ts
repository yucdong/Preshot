// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { createCanvasPdfExporter } from "./canvasPdfExporter";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const loadFonts = async () => ({
  regular: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.otf")),
  bold: new Uint8Array(readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.otf")),
});

describe("createCanvasPdfExporter", () => {
  it("produces a valid PDF from a canvas layout with plan component", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 2,
      components: [
        {
          id: "p1",
          type: "plan",
          widthFraction: "1",
          height: 200,
          html: "<h1>标题</h1><p>段落 <strong>粗体</strong> text</p>",
        },
      ],
    };

    const bytes = await exporter.export(plan, {});

    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  }, 20000);

  it("produces a valid PDF from a canvas layout with reference component", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 2,
      components: [
        {
          id: "r1",
          type: "reference",
          widthFraction: "1",
          height: 320,
          title: "参考照片",
          description: "描述 <em>italic</em>",
          columnsPerRow: 2,
          showCaptions: true,
          images: [
            { id: "img1", file: "photo1.png", caption: "图1" },
            { id: "img2", file: "photo2.png", caption: "图2" },
          ],
        },
      ],
    };

    const bytes = await exporter.export(plan, {
      "photo1.png": TINY_PNG,
      "photo2.png": TINY_PNG,
    });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("produces multi-page PDF when components span pages", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 2,
      components: [
        {
          id: "p1",
          type: "plan",
          widthFraction: "1",
          height: 650,
          html: "<p>第一页内容</p>",
        },
        {
          id: "p2",
          type: "plan",
          widthFraction: "1",
          height: 200,
          html: "<p>第二页内容</p>",
        },
      ],
    };

    const bytes = await exporter.export(plan, {});

    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(2);
  }, 20000);

  it("renders mixed component types correctly", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 2,
      components: [
        {
          id: "p1",
          type: "plan",
          widthFraction: "1/2",
          height: 200,
          html: "<p>Left <u>underline</u></p>",
        },
        {
          id: "r1",
          type: "reference",
          widthFraction: "1/2",
          height: 200,
          title: "Right",
          description: "",
          columnsPerRow: 1,
          showCaptions: false,
          images: [{ id: "img1", file: "photo.png" }],
        },
      ],
    };

    const bytes = await exporter.export(plan, { "photo.png": TINY_PNG });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("handles reference with single image column", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 2,
      components: [
        {
          id: "r1",
          type: "reference",
          widthFraction: "1",
          height: 320,
          title: "单列参考",
          description: "单列布局",
          columnsPerRow: 1,
          showCaptions: false,
          images: [{ id: "img1", file: "photo.png" }],
        },
      ],
    };

    const bytes = await exporter.export(plan, { "photo.png": TINY_PNG });

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);

  it("renders per-image captions when showCaptions is true", async () => {
    const exporter = createCanvasPdfExporter(loadFonts);
    const plan: ProjectPlan = {
      schemaVersion: 2,
      components: [
        {
          id: "r1",
          type: "reference",
          widthFraction: "1",
          height: 360,
          title: "照片集",
          description: "带说明的参考照片",
          columnsPerRow: 2,
          showCaptions: true,
          images: [
            { id: "img1", file: "photo1.png", caption: "日出 — 黄金时段" },
            { id: "img2", file: "photo2.png", caption: "中午 — 强光" },
            { id: "img3", file: "photo3.png", caption: "黄昏 — 蓝调时段" },
          ],
        },
      ],
    };

    const bytes = await exporter.export(plan, {
      "photo1.png": TINY_PNG,
      "photo2.png": TINY_PNG,
      "photo3.png": TINY_PNG,
    });

    // Assert PDF is produced without throwing and has the expected page count
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
  }, 20000);
});
