// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { preshotBlockNoteSchema } from "../../features/plan/blocknote/preshotBlockNoteSchema";
import { createLegacyBlockNotePdfExporter } from "./blockNotePdfExporter";
import {
  imageDataFromDataUrl,
  type PdfImageDrawBox,
  type PdfImageView,
} from "./pdfImageOptimizer";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const loadFonts = async () => ({
  regular: new Uint8Array(
    readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
  ),
  bold: new Uint8Array(
    readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf"),
  ),
});

describe("createLegacyBlockNotePdfExporter", () => {
  it("exports a native BlockNote JSON document", async () => {
    const exporter = createLegacyBlockNotePdfExporter(
      loadFonts,
      preshotBlockNoteSchema,
    );
    const bytes = await exporter.export({
      schemaVersion: 15,
      artifacts: [],
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "paragraph",
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: "BlockNote PDF", styles: {} }],
          children: [],
        }],
      },
      imageGroups: [],
    }, {});

    expect(bytes.slice(0, 4)).toEqual(
      Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
    );
  }, 20_000);

  it("exports physically cropped image metadata without applying the old crop twice", async () => {
    const optimizeImage = vi.fn(async (
      dataUrl: string,
      _drawBox: PdfImageDrawBox,
      _view?: PdfImageView,
    ) => imageDataFromDataUrl(dataUrl));
    const exporter = createLegacyBlockNotePdfExporter(
      loadFonts,
      preshotBlockNoteSchema,
      { optimizeImage },
    );

    await exporter.export({
      schemaVersion: 15,
      artifacts: [],
      title: "Cropped",
      document: {
        format: "preshot-blocks",
        version: 3,
        blocks: [{
          id: "group-block",
          type: "imageGroup",
          props: { groupId: "group-1" },
          content: undefined,
          children: [],
        }],
      },
      imageGroups: [{
        id: "group-1",
        name: "References",
        type: "reference",
        x: 0,
        width: 300,
        height: 160,
        description: "",
        images: [{
          id: "image-1",
          file: "references/look.png",
          aspectRatio: 1,
          sourceWidth: 600,
          sourceHeight: 600,
          frameWidth: 120,
          frameHeight: 120,
          crop: { x: 0, y: 0, width: 1, height: 1 },
        }],
      }],
    }, {
      "references/look.png": TINY_PNG,
    });

    expect(optimizeImage).toHaveBeenCalledTimes(1);
    const [dataUrl, drawBox, view] = optimizeImage.mock.calls[0]!;
    expect(dataUrl).toBe(TINY_PNG);
    expect(drawBox.width / drawBox.height).toBeCloseTo(1);
    expect(view).toEqual({ crop: { x: 0, y: 0, width: 1, height: 1 } });
  }, 20_000);
});
