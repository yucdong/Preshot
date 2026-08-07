export const NORMAL_CAPTION_FONT_SIZE = 9;
export const MIN_CAPTION_FONT_SIZE = 5;

const LINE_HEIGHT_MULTIPLIER = 1.2;
const VERTICAL_PADDING = 4;
const AVERAGE_CHARACTER_WIDTH = 0.55;

export interface CaptionTextSizing {
  captionHeight: number;
  fontSize: number;
  imageHeight: number;
  lineHeight: number;
  lines: string[];
  totalHeight: number;
}

function charactersPerLine(width: number, fontSize: number): number {
  return Math.max(1, Math.floor(width / (fontSize * AVERAGE_CHARACTER_WIDTH)));
}

function splitLongWord(word: string, maxCharacters: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < word.length; start += maxCharacters) {
    pieces.push(word.slice(start, start + maxCharacters));
  }
  return pieces;
}

export function wrapCaptionText(
  caption: string,
  width: number,
  fontSize: number,
): string[] {
  const text = caption.trim();
  if (!text) {
    return [];
  }

  const maxCharacters = charactersPerLine(Math.max(1, width), fontSize);
  const words = text.split(/\s+/).flatMap((word) => splitLongWord(word, maxCharacters));
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
    }
    line = word;
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

export function calculateCaptionTextSizing(input: {
  caption: string | undefined;
  width: number;
  imageHeight: number;
}): CaptionTextSizing {
  const imageHeight = Math.max(0, input.imageHeight);
  if (!input.caption?.trim()) {
    return {
      captionHeight: 0,
      fontSize: NORMAL_CAPTION_FONT_SIZE,
      imageHeight,
      lineHeight: NORMAL_CAPTION_FONT_SIZE * LINE_HEIGHT_MULTIPLIER,
      lines: [],
      totalHeight: imageHeight,
    };
  }

  for (let fontSize = NORMAL_CAPTION_FONT_SIZE; fontSize >= MIN_CAPTION_FONT_SIZE; fontSize -= 1) {
    const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
    const lines = wrapCaptionText(input.caption, input.width, fontSize);
    const captionHeight = lines.length * lineHeight + VERTICAL_PADDING;
    if (captionHeight <= imageHeight / 2) {
      return {
        captionHeight,
        fontSize,
        imageHeight,
        lineHeight,
        lines,
        totalHeight: imageHeight + captionHeight,
      };
    }
  }

  const fontSize = MIN_CAPTION_FONT_SIZE;
  const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
  const lines = wrapCaptionText(input.caption, input.width, fontSize);
  const captionHeight = lines.length * lineHeight + VERTICAL_PADDING;
  const effectiveImageHeight = Math.max(imageHeight, captionHeight * 2);
  return {
    captionHeight,
    fontSize,
    imageHeight: effectiveImageHeight,
    lineHeight,
    lines,
    totalHeight: effectiveImageHeight + captionHeight,
  };
}
