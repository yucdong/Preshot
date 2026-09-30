import { expect, it } from "vitest";
import { createEmptyProjectPlanV15 } from "./blockDocument";
import { imageDerivativeRequests } from "./imageDerivativeRequests";
import { imageAssetKey, imageAssetSource, nativeMediaAssets, referenceImageAssets } from "./imagePresentation";

it("requests separate raw and EXIF derivatives without changing persisted source identities", () => {
  const plan = createEmptyProjectPlanV15("Mixed", { makeId: () => "text" });
  plan.imageGroups = [{ id: "g", type: "reference", name: "", description: "", x: 0, width: 800, height: 300, images: [
    { id: "old", file: "references/photo.jpg", aspectRatio: 1.5, frameWidth: 300, frameHeight: 200 },
    { id: "new", file: "references/photo.jpg", presentationAxes: "exif", aspectRatio: 2 / 3, frameWidth: 200, frameHeight: 300 },
  ] }];
  plan.document.blocks.push(...[undefined, "exif" as const].map((axes, index) => ({
    id: `n${index}`, type: "image" as const, props: { url: "media/photo.jpg", ...(axes ? { presentationAxes: axes } : {}) }, children: [], content: undefined,
  })));
  const before = structuredClone(plan);
  expect([...imageDerivativeRequests(plan, 1008).keys()]).toEqual([
    "references/photo.jpg", "references/photo.jpg#preshot-exif", "media/photo.jpg", "media/photo.jpg#preshot-exif",
  ]);
  expect(referenceImageAssets(plan).size).toBe(2);
  expect(nativeMediaAssets(plan.document).size).toBe(2);
  expect(imageAssetSource(imageAssetKey("references/photo.jpg", "exif"))).toEqual({ file: "references/photo.jpg", presentationAxes: "exif" });
  expect(imageAssetKey("https://example.com/photo.jpg", "exif")).toBe("https://example.com/photo.jpg");
  expect(plan).toEqual(before);
});
