import { describe, expect, it } from "vitest";
import { createEmptyProjectPlanV15 } from "../plan/canvas/blockDocument";
import type { MaterialImageSelection, MaterialPayload, PreparedMaterialInsert } from "./models";
import { insertPreparedMaterial, selectMaterialImages } from "./materialInsertion";

const payload: MaterialPayload = { format: "preshot-material", version: 1, kind: "imageGroup", component: {
  kind: "imageGroup", name: "窗边组", description: "组的描述", images: ["first", "middle", "last"].map((id) => ({
    localImageId: id, caption: id, aspectRatio: 1.5, frameWidth: 300, frameHeight: 200,
    crop: { x: 0, y: 0, width: 1, height: 1 }, fitMode: "cover",
  })),
} };
function prepared(selection?: MaterialImageSelection): PreparedMaterialInsert {
  const selected = selectMaterialImages(payload, selection);
  if (selected.component.kind !== "imageGroup") throw new Error("fixture");
  return { operationId: "op", materialId: "material", revision: 1, payload: selected,
    ...(selection ? { selection } : {}),
    images: selected.component.images.map((image, index) => ({ localImageId: image.localImageId,
      file: `${selection?.mode === "images" ? "media" : "references"}/${index + 1}.png` })),
  };
}
describe("image-group material insertion selection", () => {
  it.each(["image", "imageGroup"] as const)("appends %s material images to an existing group without adding blocks", (kind) => {
    const plan = createEmptyProjectPlanV15("target", { makeId: () => "anchor" });
    const first = insertPreparedMaterial(plan, prepared({ mode: "imageGroup", imageIds: ["middle"] }), null, (() => { let id = 0; return () => `existing-${++id}`; })()).plan;
    const before = structuredClone(first);
    const reply = prepared({ mode: "imageGroup", imageIds: ["last", "first"] });
    reply.targetGroupId = first.imageGroups[0].id;
    if (kind === "image" && reply.payload.component.kind === "imageGroup") {
      reply.payload = { ...reply.payload, kind, component: { ...reply.payload.component, kind, images: reply.payload.component.images.slice(0, 1) } };
      reply.images = reply.images.slice(0, 1);
      delete reply.selection;
    }
    reply.images.forEach((image, index) => { image.file = `references/${index + 50}.png`; });
    let id = 0;
    const result = insertPreparedMaterial(first, reply, null, () => `added-${++id}`);
    expect(result.plan.document).toEqual(before.document);
    expect(result.plan.imageGroups).toHaveLength(1);
    expect(result.plan.imageGroups[0]).toMatchObject({ ...before.imageGroups[0], images: expect.any(Array) });
    expect(result.plan.imageGroups[0].images.map((image) => image.caption)).toEqual(kind === "image" ? ["middle", "first"] : ["middle", "first", "last"]);
    expect(result.plan.imageGroups[0].images[1]).toMatchObject({ crop: { x: 0, y: 0, width: 1, height: 1 }, fitMode: "cover" });
    expect(first).toEqual(before);
    expect(() => insertPreparedMaterial(first, { ...reply, targetGroupId: "missing" }, null, () => `added-${++id}`)).toThrow();
    reply.images[0].file = first.imageGroups[0].images[0].file;
    expect(() => insertPreparedMaterial(first, reply, null, () => `added-${++id}`)).toThrow();
  });

  it.each([undefined, { mode: "imageGroup", imageIds: ["last", "first"] }] as const)("keeps complete or selected groups with their metadata", (selection) => {
    const plan = createEmptyProjectPlanV15("target", { makeId: () => "anchor" });
    let id = 0;
    const result = insertPreparedMaterial(plan, prepared(selection ? { ...selection, imageIds: [...selection.imageIds] } : undefined), "anchor", () => `new-${++id}`);
    expect(result.plan.imageGroups[0]).toMatchObject({ name: "窗边组", description: "组的描述" });
    expect(result.plan.imageGroups[0].images.map((image) => image.caption)).toEqual(selection ? ["first", "last"] : ["first", "middle", "last"]);
    expect(result.plan.document.blocks.map((block) => block.type)).toEqual(["paragraph", "imageGroup"]);
    expect(plan.imageGroups).toEqual([]);
  });
  it.each([{ imageIds: ["middle"] }, { imageIds: ["last", "first"] }])("inserts $imageIds as contiguous native images in source order", ({ imageIds }) => {
    const plan = createEmptyProjectPlanV15("target", { makeId: () => "anchor" });
    let id = 0;
    const result = insertPreparedMaterial(plan, prepared({ mode: "images", imageIds }), null, () => `new-${++id}`);
    expect(result.plan.imageGroups).toEqual([]);
    expect(result.plan.document.blocks.slice(0, -1).map((block) => [block.type, block.props.caption])).toEqual(
      imageIds.length === 1 ? [["image", "middle"]] : [["image", "first"], ["image", "last"]]);
    expect(result.plan.document.blocks.at(-1)?.id).toBe("anchor");
    expect(result.lastBlockId).toBe(result.plan.document.blocks.at(-2)?.id);
  });
  it("rejects empty, duplicate, foreign selections and reused native files", () => {
    for (const imageIds of [[], ["first", "first"], ["missing"]]) {
      expect(() => prepared({ mode: "images", imageIds })).toThrow();
    }
    const reply = prepared({ mode: "images", imageIds: ["first", "last"] });
    reply.images[1].file = reply.images[0].file;
    let id = 0;
    expect(() => insertPreparedMaterial(createEmptyProjectPlanV15("t", { makeId: () => "anchor" }), reply, null, () => `new-${++id}`)).toThrow(/newly copied/);
  });
});
