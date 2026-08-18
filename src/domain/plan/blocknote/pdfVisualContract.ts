declare const measurementUnit: unique symbol;

type Measurement<Unit extends string> = number & {
  readonly [measurementUnit]: Unit;
};

export type EditorLogicalUnits = Measurement<"editor-logical-unit">;
export type EditorPixels = Measurement<"editor-pixel">;
export type SourcePixels = Measurement<"source-pixel">;
export type PdfPoints = Measurement<"pdf-point">;
export type PdfScale = Measurement<"pdf-scale">;
export type HexColor = `#${string}`;

export interface EditorLogicalSize {
  width: EditorLogicalUnits;
  height: EditorLogicalUnits;
}

export interface SourcePixelSize {
  width: SourcePixels;
  height: SourcePixels;
}

export interface PdfPointSize {
  width: PdfPoints;
  height: PdfPoints;
}

export const editorLogicalUnits = (value: number): EditorLogicalUnits =>
  value as EditorLogicalUnits;
export const editorPixels = (value: number): EditorPixels =>
  value as EditorPixels;
export const sourcePixels = (value: number): SourcePixels =>
  value as SourcePixels;
export const pdfPoints = (value: number): PdfPoints => value as PdfPoints;

const PDF_POINT_PRECISION = 4;
const roundPdfNumber = (value: number): number => {
  const rounded = Number(value.toFixed(PDF_POINT_PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
};
const roundedPdfPoints = (value: number): PdfPoints =>
  pdfPoints(roundPdfNumber(value));
const pdfScale = (value: number): PdfScale => value as PdfScale;

const A4_WIDTH = pdfPoints(595.28);
const A4_HEIGHT = pdfPoints(841.89);
const PAGE_MARGIN = pdfPoints(24);
const PAGE_CONTENT_WIDTH = pdfPoints(547.28);
const PAGE_CONTENT_HEIGHT = pdfPoints(793.89);
const EDITOR_OUTER_WIDTH = editorLogicalUnits(1080);
const EDITOR_CONTENT_WIDTH = editorLogicalUnits(1008);
const ROOT_LOGICAL_TO_PDF_SCALE = pdfScale(
  PAGE_CONTENT_WIDTH / EDITOR_CONTENT_WIDTH,
);
const BODY_SIZE = pdfPoints(11);
const EDITOR_BODY_SIZE = editorPixels(16);
const EDITOR_HEADING_SIZES = {
  h1: editorPixels(32),
  h2: editorPixels(24),
  h3: editorPixels(20),
  h4: editorPixels(18),
  h5: editorPixels(16),
  h6: editorPixels(14),
} as const;
const TYPOGRAPHY_SCALE = BODY_SIZE / EDITOR_BODY_SIZE;
const headingPdfSize = (size: EditorPixels): PdfPoints =>
  roundedPdfPoints(size * TYPOGRAPHY_SCALE);
const headingLineHeight = (size: PdfPoints): PdfPoints =>
  roundedPdfPoints(size * 1.2);

export const PDF_VISUAL_CONTRACT = {
  page: {
    size: "A4",
    width: A4_WIDTH,
    height: A4_HEIGHT,
    margin: PAGE_MARGIN,
    contentWidth: PAGE_CONTENT_WIDTH,
    contentHeight: PAGE_CONTENT_HEIGHT,
  },
  editor: {
    outerWidth: EDITOR_OUTER_WIDTH,
    contentWidth: EDITOR_CONTENT_WIDTH,
    horizontalPadding: editorLogicalUnits(36),
    rootLogicalToPdfScale: ROOT_LOGICAL_TO_PDF_SCALE,
    zoomPolicy: "ignored-during-export",
  },
  typography: {
    editorBodySize: EDITOR_BODY_SIZE,
    editorHeadingSizes: EDITOR_HEADING_SIZES,
    editorPixelToPdfPointScale: pdfScale(TYPOGRAPHY_SCALE),
    body: {
      fontSize: BODY_SIZE,
      lineHeight: pdfPoints(14.85),
    },
    headings: {
      h1: {
        fontSize: headingPdfSize(EDITOR_HEADING_SIZES.h1),
        lineHeight: headingLineHeight(
          headingPdfSize(EDITOR_HEADING_SIZES.h1),
        ),
      },
      h2: {
        fontSize: headingPdfSize(EDITOR_HEADING_SIZES.h2),
        lineHeight: headingLineHeight(
          headingPdfSize(EDITOR_HEADING_SIZES.h2),
        ),
      },
      h3: {
        fontSize: headingPdfSize(EDITOR_HEADING_SIZES.h3),
        lineHeight: headingLineHeight(
          headingPdfSize(EDITOR_HEADING_SIZES.h3),
        ),
      },
      h4: {
        fontSize: headingPdfSize(EDITOR_HEADING_SIZES.h4),
        lineHeight: headingLineHeight(
          headingPdfSize(EDITOR_HEADING_SIZES.h4),
        ),
      },
      h5: {
        fontSize: headingPdfSize(EDITOR_HEADING_SIZES.h5),
        lineHeight: headingLineHeight(
          headingPdfSize(EDITOR_HEADING_SIZES.h5),
        ),
      },
      h6: {
        fontSize: headingPdfSize(EDITOR_HEADING_SIZES.h6),
        lineHeight: headingLineHeight(
          headingPdfSize(EDITOR_HEADING_SIZES.h6),
        ),
      },
    },
    code: {
      fontSize: pdfPoints(9),
      lineHeight: pdfPoints(12.6),
    },
  },
  spacing: {
    paragraph: {
      before: pdfPoints(0),
      after: pdfPoints(6),
    },
    list: {
      indent: pdfPoints(16),
      markerGap: pdfPoints(4),
      itemGap: pdfPoints(2),
      after: pdfPoints(6),
    },
    quote: {
      before: pdfPoints(6),
      after: pdfPoints(6),
      paddingLeft: pdfPoints(10),
    },
    code: {
      before: pdfPoints(8),
      after: pdfPoints(8),
      paddingHorizontal: pdfPoints(8),
      paddingVertical: pdfPoints(6),
    },
    table: {
      before: pdfPoints(8),
      after: pdfPoints(8),
      cellPaddingHorizontal: pdfPoints(6),
      cellPaddingVertical: pdfPoints(4),
    },
    nativeImage: {
      captionGap: pdfPoints(3),
      after: pdfPoints(6),
    },
  },
  columns: {
    gap: pdfPoints(10),
    weights: {
      equalTwo: [1, 1] as const,
      equalThree: [1, 1, 1] as const,
      textImage: [0.75, 1.25] as const,
    },
  },
  colors: {
    ink: "#18181B",
    mutedInk: "#686B72",
    link: "#2563EB",
    paper: "#FFFFFF",
    softSurface: "#F7F6F4",
    codeSurface: "#F1F2F3",
    border: "#DADBDD",
    quoteBorder: "#AEB1B6",
    imageFrame: "#E7E8EA",
  } satisfies Record<string, HexColor>,
  borders: {
    hairline: pdfPoints(0.75),
    quote: pdfPoints(2),
    radius: pdfPoints(3),
  },
  imageGroup: {
    logicalInset: editorLogicalUnits(9),
    logicalGap: editorLogicalUnits(7),
    inset: roundedPdfPoints(9 * ROOT_LOGICAL_TO_PDF_SCALE),
    gap: roundedPdfPoints(7 * ROOT_LOGICAL_TO_PDF_SCALE),
    surface: "#F7F6F4" as HexColor,
    frameSurface: "#E7E8EA" as HexColor,
    border: "#DADBDD" as HexColor,
    borderWidth: pdfPoints(0.75),
    radius: pdfPoints(3),
  },
} as const;

export type PdfVisualContractErrorCode =
  | "INVALID_COLUMN_WEIGHTS"
  | "INVALID_DIMENSION";

export class PdfVisualContractError extends Error {
  constructor(
    readonly code: PdfVisualContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfVisualContractError";
  }
}

export function scaleRootEditorLogicalUnits(
  value: EditorLogicalUnits,
): PdfPoints {
  return roundedPdfPoints(
    value * PDF_VISUAL_CONTRACT.editor.rootLogicalToPdfScale,
  );
}

export function calculatePdfColumnWidths(
  weights: readonly number[],
  containerWidth: PdfPoints = PDF_VISUAL_CONTRACT.page.contentWidth,
  gap: PdfPoints = PDF_VISUAL_CONTRACT.columns.gap,
): PdfPoints[] {
  if (
    weights.length === 0 ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    throw new PdfVisualContractError(
      "INVALID_COLUMN_WEIGHTS",
      "Column weights must contain finite positive values.",
    );
  }
  const availableWidth = containerWidth - gap * (weights.length - 1);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    throw new PdfVisualContractError(
      "INVALID_DIMENSION",
      "Column container width must exceed its finite non-negative gaps.",
    );
  }

  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const widths = weights.slice(0, -1).map((weight) =>
    roundedPdfPoints(availableWidth * weight / totalWeight));
  const allocated = widths.reduce((total, width) => total + width, 0);
  widths.push(roundedPdfPoints(availableWidth - allocated));
  return widths;
}

export function scaleColumnEditorLogicalUnits(
  value: EditorLogicalUnits,
  editorColumnWidth: EditorLogicalUnits,
  pdfColumnWidth: PdfPoints,
): PdfPoints {
  if (
    !Number.isFinite(editorColumnWidth) ||
    editorColumnWidth <= 0 ||
    !Number.isFinite(pdfColumnWidth) ||
    pdfColumnWidth <= 0
  ) {
    throw new PdfVisualContractError(
      "INVALID_DIMENSION",
      "Column widths must be finite positive logical units and PDF points.",
    );
  }
  return roundedPdfPoints(value * pdfColumnWidth / editorColumnWidth);
}

export function fitKeepTogetherGroupScaleToPage(
  group: Readonly<PdfPointSize>,
  available: Readonly<PdfPointSize> = {
    width: PDF_VISUAL_CONTRACT.page.contentWidth,
    height: PDF_VISUAL_CONTRACT.page.contentHeight,
  },
): PdfScale {
  if (
    !Number.isFinite(group.width) ||
    group.width <= 0 ||
    !Number.isFinite(group.height) ||
    group.height <= 0
  ) {
    throw new PdfVisualContractError(
      "INVALID_DIMENSION",
      "Keep-together group width and height must be finite positive PDF points.",
    );
  }
  if (
    !Number.isFinite(available.width) ||
    available.width <= 0 ||
    !Number.isFinite(available.height) ||
    available.height <= 0
  ) {
    throw new PdfVisualContractError(
      "INVALID_DIMENSION",
      "Available page width and height must be finite positive PDF points.",
    );
  }

  return pdfScale(Math.min(
    1,
    available.width / group.width,
    available.height / group.height,
  ));
}
