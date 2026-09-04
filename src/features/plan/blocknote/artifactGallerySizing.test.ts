import { describe, expect, it } from "vitest";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import {
  ARTIFACT_COMPACT_MIN_SCALE,
  compactArtifactGalleryImages,
} from "./artifactGallerySizing";

const image = (id: string): ReferenceImage => ({
  id,
  file: `references/${id}.png`,
  aspectRatio: 1,
  frameWidth: 240,
  frameHeight: 240,
  frameOffsetX: 12,
  frameOffsetY: 8,
});

describe("compactArtifactGalleryImages", () => {
  it("preserves small galleries and does not mutate persisted frames", () => {
    const images = [image("1"), image("2"), image("3"), image("4")];
    expect(compactArtifactGalleryImages(images, 480, false)).toBe(images);
    const projected = compactArtifactGalleryImages([
      { ...images[0], aspectRatio: 1.5 },
      { ...images[1], aspectRatio: 0.75 },
    ], 480, true);
    expect(projected[0]).toMatchObject({
      frameHeight: 240,
      frameWidth: 360,
      frameOffsetX: 0,
      frameOffsetY: 0,
    });
    expect(projected[1]).toMatchObject({
      frameHeight: 240,
      frameWidth: 180,
    });
  });

  it("uniformly scales dense galleries with a bounded minimum", () => {
    const images = Array.from({ length: 10 }, (_, index) =>
      image(String(index))
    );
    const projected = compactArtifactGalleryImages(images, 360, true);
    const scale = projected[0].frameWidth / images[0].frameWidth;
    expect(scale).toBeGreaterThanOrEqual(ARTIFACT_COMPACT_MIN_SCALE);
    expect(scale).toBeLessThan(1);
    expect(projected.every((entry) =>
      entry.frameHeight === projected[0].frameHeight &&
      entry.frameWidth / entry.frameHeight === entry.aspectRatio
    )).toBe(true);
    expect(images[0]).toMatchObject({
      frameWidth: 240,
      frameHeight: 240,
      frameOffsetX: 12,
      frameOffsetY: 8,
    });

  });

});
