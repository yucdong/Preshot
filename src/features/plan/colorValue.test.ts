import { describe, expect, it } from "vitest";
import { hexFromRgb, rgbFromHex, validRgb } from "./colorValue";

describe("formatting color values", () => {
  it("accepts only integer RGB channels between 0 and 255", () => {
    expect(validRgb({ red: 0, green: 145, blue: 255 })).toEqual({
      red: 0,
      green: 145,
      blue: 255,
    });
    expect(validRgb({ red: -1, green: 0, blue: 0 })).toBeNull();
    expect(validRgb({ red: 0, green: 256, blue: 0 })).toBeNull();
    expect(validRgb({ red: 1.5, green: 0, blue: 0 })).toBeNull();
  });

  it("normalizes RGB values into uppercase six-digit hex", () => {
    expect(hexFromRgb({ red: 8, green: 145, blue: 178 })).toBe("#0891B2");
    expect(rgbFromHex("#0891b2")).toEqual({ red: 8, green: 145, blue: 178 });
    expect(rgbFromHex("#fff")).toEqual({ red: 255, green: 255, blue: 255 });
    expect(rgbFromHex("rgb(8, 145, 178)")).toBeNull();
  });
});