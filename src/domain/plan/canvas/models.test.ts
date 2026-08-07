import { describe, expect, it } from "vitest";
import {
  clampHeight,
  clampWidth,
  clampImageHeight,
  clampContentScale,
  EMPTY_PLAN,
  MIN_COMPONENT_HEIGHT,
  MIN_WIDTH,
  DEFAULT_WIDTH,
  DEFAULT_IMAGE_HEIGHT,
  DOCUMENT_TITLE_HEIGHT,
  MIN_IMAGE_HEIGHT,
  MAX_IMAGE_HEIGHT,
  MIN_CONTENT_SCALE,
  MAX_CONTENT_SCALE,
  DEFAULT_CONTENT_SCALE,
  UNTITLED_PLAN_TITLE,
} from "./models";

describe("canvas models", () => {
  it("clamps width to (MIN_WIDTH, 1]", () => {
    expect(clampWidth(2)).toBe(DEFAULT_WIDTH); // > 1 clamps to 1
    expect(clampWidth(0.5)).toBe(0.5); // within range
    expect(clampWidth(0.05)).toBe(MIN_WIDTH); // < MIN clamps to MIN
    expect(clampWidth(Number.NaN)).toBe(MIN_WIDTH); // NaN clamps to MIN
  });

  it("clamps imageHeight to [MIN_IMAGE_HEIGHT, MAX_IMAGE_HEIGHT]", () => {
    expect(clampImageHeight(50)).toBe(MIN_IMAGE_HEIGHT); // below min
    expect(clampImageHeight(180)).toBe(180); // within range
    expect(clampImageHeight(500)).toBe(MAX_IMAGE_HEIGHT); // above max
    expect(clampImageHeight(Number.NaN)).toBe(MIN_IMAGE_HEIGHT); // NaN clamps to min
  });

  it("clamps height between the minimum and a supplied maximum", () => {
    expect(clampHeight(10, 500)).toBe(MIN_COMPONENT_HEIGHT);
    expect(clampHeight(900, 500)).toBe(500);
    expect(clampHeight(300, 500)).toBe(300);
    expect(clampHeight(Number.NaN, 500)).toBe(MIN_COMPONENT_HEIGHT);
  });

  it("clamps contentScale to its documented persisted range", () => {
    expect(clampContentScale(0.1)).toBe(MIN_CONTENT_SCALE);
    expect(clampContentScale(1.25)).toBe(1.25);
    expect(clampContentScale(3)).toBe(MAX_CONTENT_SCALE);
    expect(clampContentScale(Number.NaN)).toBe(DEFAULT_CONTENT_SCALE);
  });

  it("provides the v6 schema constants and an empty titled plan", () => {
    expect(MIN_IMAGE_HEIGHT).toBe(67.5);
    expect(DEFAULT_IMAGE_HEIGHT).toBe(135);
    expect(MAX_IMAGE_HEIGHT).toBe(400);
    expect(DOCUMENT_TITLE_HEIGHT).toBe(36);
    expect(EMPTY_PLAN).toEqual({
      schemaVersion: 6,
      title: UNTITLED_PLAN_TITLE,
      components: [],
    });
  });
});
