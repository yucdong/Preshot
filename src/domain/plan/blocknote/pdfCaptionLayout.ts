export type PdfCaptionTextMeasurer = (
  text: string,
  fontSize: number,
) => number;

export interface PdfCaptionLayout {
  readonly lines: readonly string[];
  readonly height: number;
}

export interface FittedPdfImageCaption {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly captionWidth: number;
  readonly caption: PdfCaptionLayout;
  readonly totalHeight: number;
}

const isCjk = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x3000 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x20000 && codePoint <= 0x2ffff)
  );
};

const tokens = (value: string): string[] => {
  const result: string[] = [];
  let word = "";
  const flushWord = () => {
    if (word) result.push(word);
    word = "";
  };

  for (const character of value) {
    if (character === "\r") continue;
    if (character === "\n") {
      flushWord();
      result.push("\n");
    } else if (/\s/u.test(character)) {
      flushWord();
      result.push(" ");
    } else if (isCjk(character)) {
      flushWord();
      result.push(character);
    } else {
      word += character;
    }
  }
  flushWord();
  return result;
};

function splitToken(
  token: string,
  width: number,
  fontSize: number,
  measureText: PdfCaptionTextMeasurer,
): string[] {
  if (measureText(token, fontSize) <= width) return [token];
  const pieces: string[] = [];
  let piece = "";
  for (const character of token) {
    const candidate = piece + character;
    if (piece && measureText(candidate, fontSize) > width) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

export function layoutPdfCaption(
  value: string,
  width: number,
  input: {
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly gap: number;
    readonly measureText: PdfCaptionTextMeasurer;
  },
): PdfCaptionLayout {
  if (!value) return { lines: [], height: 0 };
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("Caption width must be a finite positive number.");
  }

  const lines: string[] = [];
  let line = "";
  let pendingSpace = false;
  const flushLine = () => {
    lines.push(line);
    line = "";
    pendingSpace = false;
  };

  for (const token of tokens(value)) {
    if (token === "\n") {
      flushLine();
      continue;
    }
    if (token === " ") {
      pendingSpace = line.length > 0;
      continue;
    }

    for (const piece of splitToken(
      token,
      width,
      input.fontSize,
      input.measureText,
    )) {
      const separator = pendingSpace && line ? " " : "";
      const candidate = line + separator + piece;
      if (
        line &&
        input.measureText(candidate, input.fontSize) > width
      ) {
        flushLine();
        line = piece;
      } else {
        line = candidate;
      }
      pendingSpace = false;
    }
  }
  if (line || lines.length === 0) flushLine();

  return {
    lines,
    height: input.gap + lines.length * input.lineHeight,
  };
}

export function fitPdfImageCaptionToPage(input: {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly maxWidth: number;
  readonly captionWidth: number;
  readonly maxHeight: number;
  readonly blockSpacing: number;
  readonly caption: string;
  readonly captionFontSize: number;
  readonly captionLineHeight: number;
  readonly captionGap: number;
  readonly measureText: PdfCaptionTextMeasurer;
}): FittedPdfImageCaption {
  const initialScale = Math.min(1, input.maxWidth / input.imageWidth);
  const captionWidth = Math.min(input.maxWidth, input.captionWidth);
  const caption = layoutPdfCaption(input.caption, captionWidth, {
    fontSize: input.captionFontSize,
    lineHeight: input.captionLineHeight,
    gap: input.captionGap,
    measureText: input.measureText,
  });
  const availableImageHeight =
    input.maxHeight - caption.height - input.blockSpacing;
  if (!Number.isFinite(availableImageHeight) || availableImageHeight <= 0) {
    throw new Error("Caption and block spacing exceed usable page height.");
  }
  const scale = Math.min(
    initialScale,
    availableImageHeight / input.imageHeight,
  );
  const width = input.imageWidth * scale;
  const height = input.imageHeight * scale;

  return {
    scale,
    width,
    height,
    captionWidth,
    caption,
    totalHeight: height + caption.height + input.blockSpacing,
  };
}
