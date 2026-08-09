import { createFont } from "fonteditor-core";
import type { ProjectPlan } from "../../domain/plan/canvas/models";
import { parseHtmlToBlocks, type Block } from "./htmlToBlocks";

const GENERATED_PDF_CHARACTERS = " 0123456789.•";

function blockText(block: Block): string {
  if (block.type === "list") {
    return block.items.flatMap((item) => item.map((run) => run.text)).join("");
  }
  return block.runs.map((run) => run.text).join("");
}

export function pdfDocumentText(plan: ProjectPlan): string {
  const text = [plan.title, GENERATED_PDF_CHARACTERS];
  for (const component of plan.components) {
    text.push(component.name);
    const html = component.type === "plan" ? component.html : component.description;
    text.push(...parseHtmlToBlocks(html).map(blockText));
  }
  return text.join("");
}

export function subsetPdfFont(fontBytes: Uint8Array, text: string): Uint8Array {
  const subset = Array.from(
    new Set(Array.from(text, (character) => character.codePointAt(0) ?? 0)),
  );
  const source = fontBytes.slice().buffer;
  const font = createFont(source, {
    type: "ttf",
    subset,
    hinting: false,
    kerning: false,
    compound2simple: true,
  });
  const output: unknown = font.write({
    type: "ttf",
    hinting: false,
    kerning: false,
    writeZeroContoursGlyfData: false,
  });
  if (ArrayBuffer.isView(output)) {
    return new Uint8Array(
      output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
    );
  }
  if (output instanceof ArrayBuffer) {
    return new Uint8Array(output);
  }
  throw new Error("Unable to write the PDF TrueType font subset");
}
