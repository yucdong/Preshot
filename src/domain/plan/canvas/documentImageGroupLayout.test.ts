import { describe, expect, it } from "vitest";
import type { ReferenceImage } from "./models";
import {
  DOCUMENT_IMAGE_GROUP_GAP,
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroupForWidth,
} from "./documentImageGroupLayout";

function image(id: string, frameWidth: number, frameHeight: number): ReferenceImage {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: frameWidth / frameHeight,
    frameWidth,
    frameHeight,
  };
}

describe("document image-group layout", () => {
  it("keeps three 320 by 240 frames on one exact-fit row", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [
        image("a", 320, 240),
        image("b", 320, 240),
        image("c", 320, 240),
      ],
      992,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots.map((slot) => slot.y)).toEqual([0, 0, 0]);
    expect(layout.slots.map((slot) => [slot.width, slot.height])).toEqual([
      [320, 240],
      [320, 240],
      [320, 240],
    ]);
  });

  it("wraps at exact-fit plus one without shrinking any frame", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [
        image("a", 320, 240),
        image("b", 320, 240),
        image("c", 321, 240),
      ],
      992,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 0, y: 0, width: 320, height: 240 },
      { id: "b", x: 327, y: 0, width: 320, height: 240 },
      { id: "c", x: 0, y: 247, width: 321, height: 240 },
    ]);
  });

  it("keeps two 480 by 240 frames on one exact-fit row", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("a", 480, 240), image("b", 480, 240)],
      985,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 0, y: 0, width: 480, height: 240 },
      { id: "b", x: 487, y: 0, width: 480, height: 240 },
    ]);
  });

  it("preserves mixed aspect-derived widths at the shared 240 height", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [
        image("landscape", 360, 240),
        image("square", 240, 240),
        image("portrait", 180, 240),
      ],
      812,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots.map((slot) => ({
      id: slot.id,
      width: slot.width,
      height: slot.height,
      y: slot.y,
    }))).toEqual([
      { id: "landscape", width: 360, height: 240, y: 0 },
      { id: "square", width: 240, height: 240, y: 0 },
      { id: "portrait", width: 180, height: 240, y: 0 },
    ]);
  });

  it("wraps a user-enlarged frame instead of fitting the row", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("enlarged", 356, 267), image("neighbor", 320, 240)],
      700,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "enlarged", x: 0, y: 0, width: 356, height: 267 },
      { id: "neighbor", x: 0, y: 274, width: 320, height: 240 },
    ]);
  });

  it("preserves image sizes while they fit and wraps into another row", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("a", 120, 80), image("b", 120, 80), image("c", 120, 80)],
      280,
    );

    expect(layout.scale).toBe(1);
    expect(layout.height).toBe(185);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 0, y: 0, width: 120, height: 80 },
      { id: "b", x: 127, y: 0, width: 120, height: 80 },
      { id: "c", x: 0, y: 87, width: 120, height: 80 },
    ]);
  });

  it("wraps before overflow without overlap and derives the group height", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("a", 130, 70), image("b", 130, 90), image("c", 80, 60)],
      300,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 0, y: 0, width: 130, height: 70 },
      {
        id: "b",
        x: 130 + DOCUMENT_IMAGE_GROUP_GAP,
        y: 0,
        width: 130,
        height: 90,
      },
      {
        id: "c",
        x: 0,
        y: 90 + DOCUMENT_IMAGE_GROUP_GAP,
        width: 80,
        height: 60,
      },
    ]);
    expect(layout.height).toBe(
      DOCUMENT_IMAGE_GROUP_INSET * 2 + 90 + DOCUMENT_IMAGE_GROUP_GAP + 60,
    );
    for (const [index, slot] of layout.slots.entries()) {
      for (const other of layout.slots.slice(index + 1)) {
        const overlaps =
          slot.x < other.x + other.width &&
          slot.x + slot.width > other.x &&
          slot.y < other.y + other.height &&
          slot.y + slot.height > other.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("keeps an individually oversized image authoritative on one overflow row", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("wide", 400, 200), image("small", 80, 80)],
      300,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "wide", x: 0, y: 0, width: 400, height: 200 },
      {
        id: "small",
        x: 0,
        y: 200 + DOCUMENT_IMAGE_GROUP_GAP,
        width: 80,
        height: 80,
      },
    ]);
    expect(layout.height).toBe(
      DOCUMENT_IMAGE_GROUP_INSET * 2 +
        200 +
        DOCUMENT_IMAGE_GROUP_GAP +
        80,
    );
  });

  it("ignores persisted group height and never shrinks rows to fit it", () => {
    const width = 180;
    const layout = layoutDocumentImageGroupForWidth(
      [image("a", 160, 100), image("b", 160, 100)],
      width,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 0, y: 0, width: 160, height: 100 },
      { id: "b", x: 0, y: 107, width: 160, height: 100 },
    ]);
    expect(layout.height).toBe(225);
  });

  it("wraps at the immediate threshold while preserving order and the exact gap", () => {
    const fits = layoutDocumentImageGroupForWidth(
      [image("a", 100, 60), image("b", 175, 70)],
      300,
    );
    const wraps = layoutDocumentImageGroupForWidth(
      [image("a", 100, 60), image("b", 176, 70)],
      300,
    );

    expect(fits.slots).toMatchObject([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 107, y: 0 },
    ]);
    expect(wraps.slots).toMatchObject([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 0, y: 67 },
    ]);
    expect(wraps.slots.map((slot) => slot.id)).toEqual(["a", "b"]);
  });

  it("uses finite fallback geometry for malformed persisted dimensions", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("bad", Number.NaN, Number.POSITIVE_INFINITY)],
      Number.NaN,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots[0]).toMatchObject({
      id: "bad",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(Number.isFinite(layout.height)).toBe(true);
  });

  it("keeps the opposite edges anchored through persisted image frame offsets", () => {
    const anchored = {
      ...image("a", 100, 70),
      frameOffsetX: 20,
      frameOffsetY: 30,
    };
    const layout = layoutDocumentImageGroupForWidth(
      [anchored, image("b", 80, 80)],
      260,
    );

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 20, y: 30, width: 100, height: 70 },
      { id: "b", x: 127, y: 0, width: 80, height: 80 },
    ]);
  });
});
