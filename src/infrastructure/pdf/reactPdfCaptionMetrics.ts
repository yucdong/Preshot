import { Font } from "@react-pdf/renderer";
import regularFontUrl from "./fonts/NotoSansSC-Regular.ttf?url";
import type { PdfCaptionTextMeasurer } from "../../domain/plan/blocknote/pdfCaptionLayout";

interface MetricFont {
  readonly unitsPerEm: number;
  layout(text: string): {
    readonly positions: readonly { readonly xAdvance: number }[];
  };
}

const metricFamily = (source: string): string => {
  let hash = 0;
  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return `Preshot Caption Metrics ${Math.abs(hash)}`;
};

export async function createReactPdfCaptionTextMeasurer(
  source = regularFontUrl,
): Promise<PdfCaptionTextMeasurer> {
  const family = metricFamily(source);
  if (!Font.getRegisteredFontFamilies().includes(family)) {
    Font.register({
      family,
      src: source,
      fontStyle: "normal",
      fontWeight: 400,
    });
  }
  const descriptor = {
    fontFamily: family,
    fontStyle: "normal" as const,
    fontWeight: 400,
  };
  await Font.load(descriptor);
  const font = Font.getFont(descriptor).data as MetricFont | null;
  if (!font || !Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
    throw new Error("Unable to load PDF caption font metrics.");
  }

  return (text, fontSize) => {
    const advance = font.layout(text).positions.reduce(
      (total, position) => total + position.xAdvance,
      0,
    );
    return advance * fontSize / font.unitsPerEm;
  };
}
