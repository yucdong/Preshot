import { describe, expect, it } from "vitest";
import {
  canvasHeight,
  clampCardRect,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
  moveCard,
  resizeCard,
  snapAlignment,
  snapCardPosition,
} from "./geometry";

const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

describe("free canvas geometry", () => {
  it("clamps cards to the horizontal canvas and minimum dimensions", () => {
    expect(
      clampCardRect({ x: -10, y: -20, width: canvasWidth + 50, height: 1 }, canvasWidth),
    ).toEqual({ x: 0, y: 0, width: canvasWidth, height: 80 });

    expect(
      clampCardRect({ x: canvasWidth - 10, y: 12, width: 120, height: 90 }, canvasWidth),
    ).toEqual({ x: canvasWidth - 120, y: 12, width: 120, height: 90 });
  });

  it("moves and resizes cards independently without allowing horizontal overflow", () => {
    const card = { x: 100, y: 50, width: 240, height: 180 };

    expect(moveCard(card, { x: canvasWidth, y: -1 }, canvasWidth)).toEqual({
      x: canvasWidth - 240,
      y: 0,
      width: 240,
      height: 180,
    });
    expect(resizeCard(card, { width: 20, height: 20 }, canvasWidth)).toEqual({
      x: 100,
      y: 50,
      width: 120,
      height: 80,
    });
  });

  it("derives a continuous canvas height and reports alignment snapping inputs and results", () => {
    expect(
      canvasHeight([
        { y: 60, height: 80 },
        { y: 340, height: 100 },
      ]),
    ).toBe(464);

    expect(snapAlignment({ value: 101.5, candidates: [80, 100, 240], threshold: 4 })).toEqual({
      value: 100,
      snapped: true,
      guide: 100,
      delta: -1.5,
    });
    expect(snapAlignment({ value: 108, candidates: [100], threshold: 4 })).toEqual({
      value: 108,
      snapped: false,
      guide: null,
      delta: 0,
    });

    expect(
      snapCardPosition({
        rect: { x: 102, y: 179, width: 100, height: 80 },
        candidates: [{ x: 100, y: 180, width: 100, height: 80 }],
        threshold: 4,
      }),
    ).toMatchObject({
      rect: { x: 100, y: 180, width: 100, height: 80 },
      x: { snapped: true, guide: 100 },
      y: { snapped: true, guide: 180 },
    });
  });
});
