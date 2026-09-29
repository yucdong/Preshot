import { expect, it } from "vitest";
import { createEmptyProjectPlanV16 } from "../../../domain/plan/canvas/blockDocument";
import type { ReferenceImage } from "../../../domain/plan/canvas/models";
import { artifactCollectionGroups, replaceArtifactCollection } from "./artifactCollections";
import { imageFrameHistory } from "./imageFrameHistory";

it.each(["imageGroup", "prop"] as const)("restores %s image frames without reverting unrelated columns or metadata", kind => {
  const before = createEmptyProjectPlanV16("Before", { makeId: () => "text" });
  const image: ReferenceImage = { id: "image", file: "references/0001.png", aspectRatio: 1.5, sourceWidth: 900, sourceHeight: 600,
    frameWidth: 300, frameHeight: 200, fitMode: "cover", crop: { x: 0, y: 0, width: 1, height: 1 } };
  if (kind === "imageGroup") before.imageGroups = [{ id: "group", type: "reference", name: "Photos", description: "", x: 0, width: 1008, height: 240, images: [image] }];
  else before.artifacts = [{ id: "prop", kind: "prop", revision: 0, title: "Umbrella", source: "", gallery: { id: "group", images: [image] } }];
  const resized = { ...image, frameWidth: 360, frameOffsetX: -10, crop: { x: 0, y: 0.1, width: 1, height: 0.8 } };
  const after = replaceArtifactCollection({ ...before, imageGroups: before.imageGroups.map(group => ({ ...group, height: 250, images: [resized] })) },
    "group", collection => ({ ...collection, images: [resized] }));
  let current: typeof before = { ...after, title: "Later metadata", document: { ...after.document, blocks: [] } };
  const history = imageFrameHistory("group", "image", before, after, () => current, plan => { current = plan; });
  history!.undo();
  expect([...current.imageGroups, ...artifactCollectionGroups(current)][0].images[0]).toEqual(image);
  expect(current.title).toBe("Later metadata");
  expect(current.document.blocks).toEqual([]);
  history!.redo();
  expect([...current.imageGroups, ...artifactCollectionGroups(current)][0].images[0]).toEqual(resized);
  expect(image.frameWidth).toBe(300);
  current = { ...current, artifacts: [], imageGroups: [] };
  expect(() => history!.undo()).toThrow("方案版本已失效");
  expect(imageFrameHistory("group", "image", before, before, () => before, () => {})).toBeNull();
});
