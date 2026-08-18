// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createReactPdfBlockNoteExporter } from "../../../infrastructure/pdf/reactPdfBlockNoteExporter";
import { preshotBlockNoteSchema } from "./preshotBlockNoteSchema";

const expectedBlockSpecs = [
  "audio",
  "bulletListItem",
  "checkListItem",
  "codeBlock",
  "column",
  "columnList",
  "divider",
  "file",
  "heading",
  "image",
  "imageGroup",
  "numberedListItem",
  "pageBreak",
  "paragraph",
  "quote",
  "table",
  "toggleListItem",
  "video",
];

const expectedInlineContentSpecs = ["link", "text"];

const expectedStyleSpecs = [
  "backgroundColor",
  "bold",
  "code",
  "italic",
  "strike",
  "textColor",
  "underline",
];

describe("preshotBlockNoteSchema", () => {
  it("provides the exact production schema instance to the PDF exporter", () => {
    const exporter = createReactPdfBlockNoteExporter();

    expect(exporter.schema).toBe(preshotBlockNoteSchema);
    expect(Object.keys(exporter.schema.blockSpecs).sort()).toEqual(
      Object.keys(preshotBlockNoteSchema.blockSpecs).sort(),
    );
    expect(Object.keys(exporter.schema.inlineContentSpecs).sort()).toEqual(
      Object.keys(preshotBlockNoteSchema.inlineContentSpecs).sort(),
    );
    expect(Object.keys(exporter.schema.styleSpecs).sort()).toEqual(
      Object.keys(preshotBlockNoteSchema.styleSpecs).sort(),
    );
  });

  it("retains the complete editor block, inline-content, and style specs", () => {
    expect(Object.keys(preshotBlockNoteSchema.blockSpecs).sort()).toEqual(
      expectedBlockSpecs,
    );
    expect(
      Object.keys(preshotBlockNoteSchema.inlineContentSpecs).sort(),
    ).toEqual(expectedInlineContentSpecs);
    expect(Object.keys(preshotBlockNoteSchema.styleSpecs).sort()).toEqual(
      expectedStyleSpecs,
    );
  });
});
