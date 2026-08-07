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

const plan: ProjectPlan = {
  schemaVersion: 7,
  title: "Editorial",
  components: [
    {
      id: "p1",
      name: "Plan",
      type: "plan",
      x: 0,
      y: 60,
      width: 500,
      height: 180,
      html: "<p>正文</p>",
    },
    {
      id: "r1",
      name: "Reference",
      type: "reference",
      x: 0,
      y: 264,
      width: 500,
      height: 260,
      description: "",
      images: [{
        id: "img1",
        file: "photo.png",
        caption: "preserved but not exported",
        aspectRatio: 1,
        frameWidth: 100,
        frameHeight: 100,
      }],
    },
  ],
};

describe("createCanvasPdfExporter", () => {
  it("keeps the temporary PDF path compiling for v7 cards", async () => {
    const bytes = await createCanvasPdfExporter(loadFonts).export(plan, {
      "photo.png": TINY_PNG,
    });

    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  }, 20000);

  it("reports a missing image before attempting PDF rendering", async () => {
    await expect(createCanvasPdfExporter(loadFonts).export(plan, {})).rejects.toThrow(
      /Missing reference image data/,
    );
  });
});
