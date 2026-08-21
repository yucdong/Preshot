const MEBIBYTE = 1_048_576;

export const MAX_LONG_IMAGE_PARTS = 32;
export const MAX_LONG_IMAGE_TOTAL_BYTES = 64 * MEBIBYTE;
export const MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS = 120;
export const MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS = 120;
export const MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS = 128;

export type LongImageFormat = "jpg" | "jpeg" | "png";

export interface LongImagePart {
  fileName: string;
  bytes: Readonly<Uint8Array>;
}

export interface LongImageSaveRequest {
  format: LongImageFormat;
  baseName: string;
  defaultDirectory: string;
  parts: readonly LongImagePart[];
}

export interface LongImageSaveTarget {
  revealProjectDirectoryAfterSave?: boolean;
  save(request: LongImageSaveRequest): Promise<string[] | null>;
}

export class LongImageSaveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongImageSaveValidationError";
  }
}

const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARACTER = /[<>:"/\\|?*\p{Cc}]/u;

export function unicodeCodePointCount(value: string): number {
  return Array.from(value).length;
}

export function truncateUnicodeCodePoints(
  value: string,
  maximum: number,
): string {
  return Array.from(value).slice(0, maximum).join("");
}

export function truncateUtf16CodeUnits(
  value: string,
  maximum: number,
): string {
  let codeUnits = 0;
  const characters: string[] = [];
  for (const character of value) {
    const nextCodeUnits = codeUnits + character.length;
    if (nextCodeUnits > maximum) break;
    characters.push(character);
    codeUnits = nextCodeUnits;
  }
  return characters.join("");
}

export function isSafeLongImageBaseName(value: string): boolean {
  return (
    unicodeCodePointCount(value) > 0 &&
    unicodeCodePointCount(value) <= MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS &&
    value.length <= MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS &&
    value !== "." &&
    value !== ".." &&
    !WINDOWS_INVALID_CHARACTER.test(value) &&
    !/[ .]$/.test(value) &&
    !WINDOWS_RESERVED_NAME.test(value)
  );
}

export function isPathSafeLongImageFileName(value: string): boolean {
  return (
    value.length <= MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS &&
    value !== "." &&
    value !== ".." &&
    !WINDOWS_INVALID_CHARACTER.test(value) &&
    !/[ .]$/.test(value)
  );
}

export function validateLongImageSaveRequest(
  request: LongImageSaveRequest,
): string {
  const { baseName, format, parts } = request;
  if (!isSafeLongImageBaseName(baseName)) {
    throw new LongImageSaveValidationError(
      "The long-image base name must be a safe file name.",
    );
  }
  if (request.defaultDirectory.trim().length === 0) {
    throw new LongImageSaveValidationError(
      "The long-image default directory is required.",
    );
  }
  if (parts.length === 0 || parts.length > MAX_LONG_IMAGE_PARTS) {
    throw new LongImageSaveValidationError(
      `Long-image saves require between 1 and ${MAX_LONG_IMAGE_PARTS} parts. Shorten the plan, export smaller sections separately, or use PDF/DOCX.`,
    );
  }

  const firstExtension = getFileExtension(parts[0]?.fileName ?? "");
  if (!isFormatExtension(format, firstExtension)) {
    throw new LongImageSaveValidationError(
      `The first long-image filename does not match the ${format} format.`,
    );
  }

  const width = Math.max(2, String(parts.length).length);
  const seen = new Set<string>();
  let totalBytes = 0;
  parts.forEach((part, index) => {
    if (!(part.bytes instanceof Uint8Array)) {
      throw new LongImageSaveValidationError(
        `Long-image part ${index + 1} does not contain byte data.`,
      );
    }
    totalBytes += part.bytes.byteLength;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > MAX_LONG_IMAGE_TOTAL_BYTES
    ) {
      throw new LongImageSaveValidationError(
        `Long-image saves cannot exceed ${MAX_LONG_IMAGE_TOTAL_BYTES / MEBIBYTE} MiB of encoded data. Shorten the plan, export smaller sections separately, choose a smaller JPEG preset, or use PDF/DOCX.`,
      );
    }
    if (
      part.fileName.includes("/") ||
      part.fileName.includes("\\") ||
      part.fileName === "." ||
      part.fileName === ".." ||
      !isPathSafeLongImageFileName(part.fileName)
    ) {
      throw new LongImageSaveValidationError(
        `Long-image part ${index + 1} must use a leaf filename.`,
      );
    }

    const extension = getFileExtension(part.fileName);
    if (
      extension.toLowerCase() !== firstExtension.toLowerCase() ||
      !isFormatExtension(format, extension)
    ) {
      throw new LongImageSaveValidationError(
        "All long-image parts must use the same format extension.",
      );
    }

    const expectedName =
      parts.length === 1
        ? `${baseName}.${extension}`
        : `${baseName}-${String(index + 1).padStart(width, "0")}.${extension}`;
    if (part.fileName !== expectedName) {
      throw new LongImageSaveValidationError(
        `Long-image part ${index + 1} must be named "${expectedName}".`,
      );
    }

    const key = part.fileName.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw new LongImageSaveValidationError(
        `Long-image filename "${part.fileName}" is duplicated.`,
      );
    }
    seen.add(key);
  });

  return firstExtension;
}

export function isFormatExtension(
  format: LongImageFormat,
  extension: string,
): boolean {
  const normalized = extension.toLowerCase();
  return format === "png"
    ? normalized === "png"
    : normalized === "jpg" || normalized === "jpeg";
}

function getFileExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === fileName.length - 1) {
    return "";
  }
  return fileName.slice(extensionIndex + 1);
}
