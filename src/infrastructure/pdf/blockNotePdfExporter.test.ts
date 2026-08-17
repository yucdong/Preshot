// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBlockNotePdfExporter } from "./blockNotePdfExporter";

describe("createBlockNotePdfExporter", () => {
  it("exports a native BlockNote JSON document", async () => {
    const exporter = createBlockNotePdfExporter(async () => ({
      regular: new Uint8Array(
        readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Regular.ttf"),
      ),
      bold: new Uint8Array(
        readFileSync("src/infrastructure/pdf/fonts/NotoSansSC-Bold.ttf"),
      ),
    }));
    const bytes = await exporter.export({
      schemaVersion: 14,
      title: "Editorial",
      document: {
        format: "preshot-blocks",
        version: 2,
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
});
