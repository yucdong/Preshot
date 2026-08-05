import { describe, expect, it } from "vitest";
import {
  ADD_TILE,
  IMAGE_GAP,
  packReferenceRows,
  paginateReferenceRows,
  normalizeAspectRatio,
} from "./referenceLayout";

describe("normalizeAspectRatio", () => {
  it("falls back invalid ratios to one", () => {
    expect(normalizeAspectRatio(Number.NaN)).toBe(1);
    expect(normalizeAspectRatio(0)).toBe(1);
    expect(normalizeAspectRatio(-1)).toBe(1);
  });
});

describe("packReferenceRows", () => {
  it("uses height times ratio for landscape and portrait widths", () => {
    const rows = packReferenceRows({
      images: [
        { id: "wide", file: "w.png", aspectRatio: 4 / 3 },
        { id: "tall", file: "t.png", aspectRatio: 2 / 3 },
      ],
      imageHeight: 135,
      showCaptions: false,
      innerWidth: 500,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].slots[0]).toMatchObject({ width: 180, imageHeight: 135 });
    expect(rows[0].slots[1]).toMatchObject({ width: 90, imageHeight: 135 });
  });

  it("puts captions below images and adds one third of image height", () => {
    const [row] = packReferenceRows({
      images: [{ id: "i", file: "i.png", aspectRatio: 1 }],
      imageHeight: 135,
      showCaptions: true,
      innerWidth: 500,
    });

    expect(row.slots[0].captionHeight).toBe(45);
    expect(row.slots[0].height).toBe(180);
  });

  it("wraps the add tile onto its own row when it no longer fits", () => {
    const rows = packReferenceRows({
      images: [
        { id: "wide", file: "w.png", aspectRatio: 4 / 3 },
        { id: "tall", file: "t.png", aspectRatio: 2 / 3 },
      ],
      imageHeight: 135,
      showCaptions: false,
      innerWidth: 350,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].slots.map((slot) => slot.kind)).toEqual(["image", "image"]);
    expect(rows[1].y).toBe(rows[0].height + IMAGE_GAP);
    expect(rows[1].slots).toHaveLength(1);
    expect(rows[1].slots[0]).toMatchObject({ kind: "add", width: ADD_TILE.width, height: ADD_TILE.height });
  });

  it("scales a single oversized image proportionally to the inner width", () => {
    const rows = packReferenceRows({
      images: [{ id: "wide", file: "wide.png", aspectRatio: 5 }],
      imageHeight: 100,
      showCaptions: false,
      innerWidth: 300,
    });

    expect(rows[0].slots[0]).toMatchObject({ width: 300, imageHeight: 60, height: 60 });
  });
});

describe("paginateReferenceRows", () => {
  it("splits only between complete rows", () => {
    const fragments = paginateReferenceRows({
      rows: [
        { y: 0, height: 100, slots: [] },
        { y: 112, height: 100, slots: [] },
        { y: 224, height: 100, slots: [] },
      ],
      firstAvailableHeight: 210,
      continuationAvailableHeight: 220,
    });

    expect(fragments.map((fragment) => fragment.rows.length)).toEqual([1, 2]);
    expect(fragments.map((fragment) => fragment.kind)).toEqual(["first", "continuation"]);
  });

  it("shrinks a row that is taller than the available page height instead of looping", () => {
    const fragments = paginateReferenceRows({
      rows: [
        {
          y: 0,
          height: 300,
          slots: [
            { kind: "image", id: "img", x: 0, y: 0, width: 120, height: 300, imageHeight: 300, captionHeight: 0 },
          ],
        },
      ],
      firstAvailableHeight: 200,
      continuationAvailableHeight: 200,
    });

    expect(fragments).toHaveLength(1);
    expect(fragments[0].height).toBe(200);
    expect(fragments[0].rows).toHaveLength(1);
    expect(fragments[0].rows[0].height).toBe(200);
    expect(fragments[0].rows[0].slots[0]).toMatchObject({ width: 80, height: 200, imageHeight: 200 });
  });
});
