import { describe, expect, it } from "vitest";
import type { ProjectPlan, ReferenceComponent, ReferenceImage } from "./models";
import {
  effectiveImageAspectRatio,
  normalizeCrop,
  resetImageCrop,
  setImageCrop,
} from "./crop";

const image: ReferenceImage = { id: "i1", file: "references/0001.png", aspectRatio: 2 };
const plan: ProjectPlan = {
  schemaVersion: 5,
  title: "Editorial",
  components: [
    {
      id: "r1",
      rowId: "row-1",
      name: "图片组1",
      type: "reference",
      width: 1,
      description: "",
      showCaptions: false,
      imageHeight: 135,
      images: [image],
    },
  ],
};

describe("image crop", () => {
  it("normalizes a full crop away and rejects bounds outside the image", () => {
    expect(normalizeCrop({ x: 0, y: 0, width: 1, height: 1 })).toBeUndefined();
    expect(normalizeCrop({ x: 0.25, y: 0, width: 0.5, height: 1 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(normalizeCrop({ x: 0.75, y: 0, width: 0.5, height: 1 })).toBeUndefined();
  });

  it("calculates effective aspect ratio from a crop", () => {
    expect(
      effectiveImageAspectRatio({
        ...image,
        crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
      }),
    ).toBe(1);
  });

  it("sets and resets a reference image crop", () => {
    const crop = { x: 0, y: 0.25, width: 1, height: 0.5 };
    const cropped = setImageCrop(plan, { componentId: "r1", imageId: "i1", crop });
    expect((cropped.components[0] as ReferenceComponent).images[0].crop).toEqual(crop);
    expect((resetImageCrop(cropped, { componentId: "r1", imageId: "i1" }).components[0] as ReferenceComponent).images[0].crop).toBeUndefined();
  });
});
