import { describe, expect, it } from "vitest";
import type { ReferenceImage } from "./models";
import {
  DOCUMENT_IMAGE_GROUP_GAP,
  DOCUMENT_IMAGE_GROUP_INSET,
  layoutDocumentImageGroup,
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

describe("layoutDocumentImageGroup", () => {
  it("preserves image sizes while they fit and wraps into another row", () => {
    const layout = layoutDocumentImageGroup(
      [image("a", 120, 80), image("b", 120, 80), image("c", 120, 80)],
      280,
      200,
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

  it("scales an individually oversized image to keep it inside the group width", () => {
    const layout = layoutDocumentImageGroupForWidth(
      [image("wide", 400, 200), image("small", 80, 80)],
      300,
    );
    const availableWidth = 300 - DOCUMENT_IMAGE_GROUP_INSET * 2;

    expect(layout.scale).toBeCloseTo(availableWidth / 400);
    expect(layout.slots.every(
      (slot) => slot.x + slot.width <= availableWidth + 0.001,
    )).toBe(true);
  });

  it("uses one proportional fit scale only when the group cannot contain its images", () => {
    const width = 180;
    const height = 120;
    const layout = layoutDocumentImageGroup(
      [image("a", 160, 100), image("b", 160, 100)],
      width,
      height,
    );
    const availableWidth = width - DOCUMENT_IMAGE_GROUP_INSET * 2;
    const availableHeight = height - DOCUMENT_IMAGE_GROUP_INSET * 2;

    expect(layout.scale).toBeLessThan(1);
    expect(layout.slots).toHaveLength(2);
    expect(layout.slots.every((slot) => slot.x + slot.width <= availableWidth + 0.001)).toBe(true);
    expect(layout.slots.every((slot) => slot.y + slot.height <= availableHeight + 0.001)).toBe(true);
  });

  it("keeps the opposite edges anchored through persisted image frame offsets", () => {
    const anchored = {
      ...image("a", 100, 70),
      frameOffsetX: 20,
      frameOffsetY: 30,
    };
    const layout = layoutDocumentImageGroup([anchored, image("b", 80, 80)], 260, 180);

    expect(layout.scale).toBe(1);
    expect(layout.slots).toMatchObject([
      { id: "a", x: 20, y: 30, width: 100, height: 70 },
      { id: "b", x: 127, y: 0, width: 80, height: 80 },
    ]);
  });
});
