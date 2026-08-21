import { describe, expect, it } from "vitest";
import {
  LongImageSaveValidationError,
  MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS,
  MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS,
  MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS,
  MAX_LONG_IMAGE_PARTS,
  MAX_LONG_IMAGE_TOTAL_BYTES,
  validateLongImageSaveRequest,
  type LongImageFormat,
} from "./longImageSave";

function request(
  format: LongImageFormat,
  fileNames: string[],
  baseName = "output-long",
) {
  return {
    format,
    baseName,
    defaultDirectory: "C:\\Editorial",
    parts: fileNames.map((fileName, index) => ({
      fileName,
      bytes: Uint8Array.of(index + 1),
    })),
  };
}

describe("validateLongImageSaveRequest", () => {
  it.each([
    ["jpg", ["output-long.jpg"]],
    ["jpeg", ["output-long.jpeg"]],
    ["jpeg", ["output-long.jpg"]],
    ["png", ["output-long.png"]],
    ["jpg", ["output-long-01.jpg", "output-long-02.jpg"]],
  ] satisfies [LongImageFormat, string[]][])(
    "accepts deterministic %s part names",
    (format, fileNames) => {
      expect(validateLongImageSaveRequest(request(format, fileNames))).toBe(
        fileNames[0]?.split(".").pop(),
      );
    },
  );

  it.each([
    ["../output-long", ["output-long.jpg"]],
    ["output-long", ["../output-long.jpg"]],
    ["output-long", ["output-long.jpg", "output-long.jpg"]],
    ["output-long", ["output-long-01.jpg", "other-02.jpg"]],
    ["output-long", ["output-long-01.jpg", "output-long-02.png"]],
  ])("rejects unsafe or inconsistent names", (baseName, fileNames) => {
    expect(() =>
      validateLongImageSaveRequest(request("jpg", fileNames, baseName)),
    ).toThrow(LongImageSaveValidationError);
  });

  it("rejects empty and excessive part lists", () => {
    expect(() =>
      validateLongImageSaveRequest(request("png", [])),
    ).toThrow(new RegExp(`between 1 and ${MAX_LONG_IMAGE_PARTS}`));
    expect(() =>
      validateLongImageSaveRequest(
        request(
          "png",
          Array.from(
            { length: MAX_LONG_IMAGE_PARTS + 1 },
            (_, index) => `output-long-${String(index + 1).padStart(2, "0")}.png`,
          ),
        ),
      ),
    ).toThrow(new RegExp(`between 1 and ${MAX_LONG_IMAGE_PARTS}`));
  });

  it("accepts the exact cumulative byte budget and rejects one byte more", () => {
    const bytes = new Uint8Array(MAX_LONG_IMAGE_TOTAL_BYTES + 1);
    expect(() =>
      validateLongImageSaveRequest({
        ...request("png", ["output-long.png"]),
        parts: [{
          fileName: "output-long.png",
          bytes: bytes.subarray(0, MAX_LONG_IMAGE_TOTAL_BYTES),
        }],
      })
    ).not.toThrow();

    expect(() =>
      validateLongImageSaveRequest({
        ...request("png", ["output-long.png"]),
        parts: [{ fileName: "output-long.png", bytes }],
      })
    ).toThrow(/64 MiB.*export smaller sections.*PDF\/DOCX/);
  });

  it("rejects many tiny parts with actionable alternatives", () => {
    const count = MAX_LONG_IMAGE_PARTS + 1;
    expect(() =>
      validateLongImageSaveRequest(
        request(
          "png",
          Array.from(
            { length: count },
            (_, index) =>
              `output-long-${String(index + 1).padStart(2, "0")}.png`,
          ),
        ),
      )
    ).toThrow(/32 parts.*export smaller sections.*PDF\/DOCX/);
  });

  it("counts Unicode code points instead of UTF-8 bytes or UTF-16 units", () => {
    const chinese = "图".repeat(43);
    expect(() =>
      validateLongImageSaveRequest(
        request("png", [`${chinese}.png`], chinese),
      )
    ).not.toThrow();

    const emoji = "😀".repeat(
      MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2,
    );
    const emojiFileName = `${emoji}.png`;
    expect(Array.from(emoji)).toHaveLength(
      MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2,
    );
    expect(() =>
      validateLongImageSaveRequest(
        request("png", [emojiFileName], emoji),
      )
    ).not.toThrow();
    expect(emojiFileName.length).toBeLessThanOrEqual(
      MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS,
    );
  });

  it("accepts the ASCII maximum and rejects one additional code point", () => {
    const maximum = "a".repeat(MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS);
    expect(() =>
      validateLongImageSaveRequest(
        request("jpg", [`${maximum}.jpg`], maximum),
      )
    ).not.toThrow();

    const excessive = `${maximum}a`;
    expect(() =>
      validateLongImageSaveRequest(
        request("jpg", [`${excessive}.jpg`], excessive),
      )
    ).toThrow(LongImageSaveValidationError);
  });

  it("accepts combining marks but preserves Windows safety checks", () => {
    const combining = "e\u0301".repeat(
      MAX_LONG_IMAGE_BASE_NAME_CODE_POINTS / 2,
    );
    expect(() =>
      validateLongImageSaveRequest(
        request("png", [`${combining}.png`], combining),
      )
    ).not.toThrow();

    for (const baseName of ["CON", "LPT1.notes", "project.", "project "]) {
      expect(() =>
        validateLongImageSaveRequest(
          request("png", [`${baseName}.png`], baseName),
        )
      ).toThrow(LongImageSaveValidationError);
    }
  });

  it("keeps maximum-length emoji names safe when numbered", () => {
    const baseName = "😀".repeat(
      MAX_LONG_IMAGE_BASE_NAME_UTF16_CODE_UNITS / 2,
    );
    const fileNames = [`${baseName}-01.jpeg`, `${baseName}-02.jpeg`];

    expect(() =>
      validateLongImageSaveRequest(request("jpeg", fileNames, baseName))
    ).not.toThrow();
    expect(fileNames.every(
      (fileName) =>
        fileName.length <= MAX_LONG_IMAGE_FILENAME_UTF16_CODE_UNITS,
    )).toBe(true);
  });
});
