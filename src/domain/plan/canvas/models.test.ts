import { describe, expect, it } from "vitest";
import {
  clampColumns,
  clampHeight,
  EMPTY_PLAN,
  fractionValue,
  MAX_COLUMNS,
  MIN_COLUMNS,
  MIN_COMPONENT_HEIGHT,
  snapWidthFraction,
  WIDTH_FRACTIONS,
} from "./models";

describe("canvas models", () => {
  it("exposes the six width fractions in descending order", () => {
    expect(WIDTH_FRACTIONS).toEqual(["1", "3/4", "2/3", "1/2", "1/3", "1/4"]);
  });

  it("parses a fraction string to its numeric value", () => {
    expect(fractionValue("1")).toBe(1);
    expect(fractionValue("1/2")).toBeCloseTo(0.5, 10);
    expect(fractionValue("2/3")).toBeCloseTo(2 / 3, 10);
  });

  it("snaps an arbitrary 0..1 ratio to the nearest allowed fraction", () => {
    expect(snapWidthFraction(0.95)).toBe("1");
    expect(snapWidthFraction(0.52)).toBe("1/2");
    expect(snapWidthFraction(0.3)).toBe("1/3");
    expect(snapWidthFraction(0.26)).toBe("1/4");
    expect(snapWidthFraction(-5)).toBe("1/4"); // clamps to the smallest
    expect(snapWidthFraction(5)).toBe("1"); // clamps to the largest
  });

  it("clamps columns into range and rounds", () => {
    expect(clampColumns(0)).toBe(MIN_COLUMNS);
    expect(clampColumns(99)).toBe(MAX_COLUMNS);
    expect(clampColumns(2.6)).toBe(3);
    expect(clampColumns(Number.NaN)).toBe(MIN_COLUMNS);
  });

  it("clamps height between the minimum and a supplied maximum", () => {
    expect(clampHeight(10, 500)).toBe(MIN_COMPONENT_HEIGHT);
    expect(clampHeight(900, 500)).toBe(500);
    expect(clampHeight(300, 500)).toBe(300);
    expect(clampHeight(Number.NaN, 500)).toBe(MIN_COMPONENT_HEIGHT);
  });

  it("provides an empty v2 plan", () => {
    expect(EMPTY_PLAN).toEqual({ schemaVersion: 2, components: [] });
  });
});
