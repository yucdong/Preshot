import { expect, it } from "vitest";
import { layoutDocumentImageGroupForWidth } from "./documentImageGroupLayout";
import type { ReferenceImage } from "./models";
const images: ReferenceImage[] = ["a", "b"].map(id => ({ id, file: `references/${id}.png`, aspectRatio: 4 / 3, frameWidth: 320, frameHeight: 240, fitMode: "cover" }));
it("scales a complete gallery without wrapping, persisting or compounding dimensions", () => {
  const original = structuredClone(images);
  const baseline = layoutDocumentImageGroupForWidth(images, 665);
  const small = layoutDocumentImageGroupForWidth(images, 318, 665);
  expect(small.rows).toHaveLength(1);
  expect(small.scale).toBeCloseTo(300 / 647);
  expect(small.slots[1].x).toBeCloseTo(327 * small.scale);
  expect(small.slots[1].x + small.slots[1].width).toBeCloseTo(300);
  expect(small.height).toBeCloseTo(240 * small.scale + 18);
  expect(layoutDocumentImageGroupForWidth(images, 665, 665)).toEqual(baseline);
  expect(images).toEqual(original);
});
it("scales signed offsets and retains reference row order for mixed frames", () => {
  const shifted = images.map((image, i) => ({ ...image, frameOffsetX: -20, frameOffsetY: i ? 35 : -10, frameWidth: i ? 180 : 320 }));
  const baseline = layoutDocumentImageGroupForWidth(shifted, 665);
  const small = layoutDocumentImageGroupForWidth(shifted, 200, 665);
  expect(small.rows.map(row => row.imageIds)).toEqual(baseline.rows.map(row => row.imageIds));
  small.slots.forEach((slot, i) => {
    expect(slot.x).toBeCloseTo(baseline.slots[i].x * small.scale);
    expect(slot.y).toBeCloseTo(baseline.slots[i].y * small.scale);
    expect(slot.height / slot.width).toBeCloseTo(baseline.slots[i].height / baseline.slots[i].width);
  });
});
