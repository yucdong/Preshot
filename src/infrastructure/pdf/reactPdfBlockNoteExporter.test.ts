import { resolve } from "node:path";
import { Font, pdf } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectPlanV14 } from "../../domain/plan/canvas/blockDocument";
import { PreshotPdfPreflightError } from "../../domain/plan/blocknote/pdfExportPreflight";
import { PDF_VISUAL_CONTRACT } from "../../domain/plan/blocknote/pdfVisualContract";
import { preshotBlockNoteSchema } from "../../features/plan/blocknote/preshotBlockNoteSchema";
import {
  createLegacyBlockNotePdfExporter,
} from "./blockNotePdfExporter";
import {
  BlockNotePdfExportError,
  createReactPdfBlockNoteExporter,
} from "./reactPdfBlockNoteExporter";
import { imageDataFromDataUrl } from "./pdfImageOptimizer";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function paragraphPlan(text = "中文拍摄计划"): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "PDF integration",
    document: {
      format: "preshot-blocks",
      version: 3,
      blocks: [{
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text, styles: {} }],
        children: [],
      }],
    },
    imageGroups: [],
  };
}

function imageGroupPlan(source: string): ProjectPlanV14 {
  return {
    schemaVersion: 15,
    artifacts: [],
    title: "PDF image group",
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
      height: 140,
      description: "",
      images: [{
        id: "image-1",
        file: source,
        aspectRatio: 1,
        sourceWidth: 600,
        sourceHeight: 600,
        frameWidth: 120,
        frameHeight: 120,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      }],
    }],
  };
}

afterEach(() => {
  Font.reset();
  vi.restoreAllMocks();
});

describe("createReactPdfBlockNoteExporter", () => {
  it("runs preflight and mappings before rendering Blob bytes as non-empty A4 PDF", async () => {
    const renderDocument = vi.fn(async (document) =>
      pdf(document).toBlob()
    );
    const exporter = createReactPdfBlockNoteExporter({
      fontSources: {
        regular: resolve(
          "src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf",
        ),
        bold: resolve(
          "src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf",
        ),
      },
      renderDocument,
    });
    const original = paragraphPlan();
    const snapshot = structuredClone(original);

    const bytes = await exporter.export(original, {});
    const parsed = await PDFDocument.load(bytes);
    const page = parsed.getPages()[0];

    expect(renderDocument).toHaveBeenCalledTimes(1);
    expect(bytes.slice(0, 4)).toEqual(
      Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
    );
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(page.getWidth()).toBeCloseTo(PDF_VISUAL_CONTRACT.page.width, 1);
    expect(page.getHeight()).toBeCloseTo(PDF_VISUAL_CONTRACT.page.height, 1);
    expect(original).toEqual(snapshot);
  }, 30_000);

  it("rejects missing assets with block, group, image, and source context", async () => {
    const source = "references/missing.png";
    const exporter = createReactPdfBlockNoteExporter();

    await expect(exporter.export(imageGroupPlan(source), {})).rejects
      .toSatisfy((error) => {
        expect(error).toBeInstanceOf(PreshotPdfPreflightError);
        expect(error.message).toContain("group-block");
        expect(error.message).toContain("group-1");
        expect(error.message).toContain("image-1");
        expect(error.message).toContain(source);
        return true;
      });
  });

  it("surfaces injected image-group mapping failures with exact context", async () => {
    const source = "references/group.png";
    const exporter = createReactPdfBlockNoteExporter({
      optimizeImage: async (dataUrl) => imageDataFromDataUrl(dataUrl),
      createImageGroupMapping: () => () => {
        throw new Error("Injected mapping failed");
      },
      renderDocument: vi.fn(),
    });

    await expect(exporter.export(imageGroupPlan(source), {
      [source]: TINY_PNG,
    })).rejects.toMatchObject({
      name: "BlockNotePdfExportError",
      stage: "mapping",
      message: expect.stringMatching(
        /group-block.*imageGroup.*group-1.*Injected mapping failed/i,
      ),
    });
  });

  it("does not silently invoke the explicitly constructible legacy adapter", async () => {
    const loadLegacyFonts = vi.fn();
    const legacy = createLegacyBlockNotePdfExporter(
      loadLegacyFonts,
      preshotBlockNoteSchema,
    );
    const exporter = createReactPdfBlockNoteExporter({
      renderDocument: vi.fn().mockRejectedValue(
        new Error("Renderer unavailable"),
      ),
    });

    expect(legacy.implementation).toBe("legacy-pdf-lib");
    await expect(exporter.export(paragraphPlan(), {})).rejects.toEqual(
      expect.objectContaining({
        name: "BlockNotePdfExportError",
        stage: "render",
        message: expect.stringContaining("Renderer unavailable"),
      }),
    );
    expect(loadLegacyFonts).not.toHaveBeenCalled();
  });

  it("rejects empty renderer output instead of returning success-shaped bytes", async () => {
    const exporter = createReactPdfBlockNoteExporter({
      renderDocument: vi.fn().mockResolvedValue(
        new Blob([], { type: "application/pdf" }),
      ),
    });

    await expect(exporter.export(paragraphPlan(), {})).rejects.toBeInstanceOf(
      BlockNotePdfExportError,
    );
  });
});
