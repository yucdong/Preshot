import { describe, expect, it } from "vitest";
import { createEmptyProjectPlanV15 } from "../plan/canvas/blockDocument";
import { createImageMaterialSnapshot } from "./imageMaterial";
import { createMaterialEditDraft, serializeMaterialEditDraft } from "./materialEditing";
import { instantiateMaterial, insertMaterialIntoPlan } from "./material";
import { validateMaterialPayload } from "./validation";

function fixture() {
  const plan = createEmptyProjectPlanV15("图片方案", { makeId: () => "anchor" });
  plan.document.blocks.push({ id: "native", type: "image", props: {
    url: "media/photo.png", name: "日落", caption: "逆光人像", previewWidth: 300, showPreview: true,
  }, content: undefined, children: [] });
  plan.document.blocks.push({ id: "group-block", type: "imageGroup", props: { groupId: "group" }, content: undefined, children: [] });
  plan.imageGroups.push({ id: "group", type: "reference", name: "组", description: "", x: 0, width: 1008, height: 320,
    images: ["one", "two"].map((id) => ({ id, file: `references/${id}.png`, caption: id,
      aspectRatio: 1.5, frameWidth: 220, frameHeight: 130, frameOffsetX: -4,
      fitMode: "stretch", crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 } })) });
  return plan;
}

describe("single image materials", () => {
  it("captures a local native image with its caption and display size", () => {
    const snapshot = createImageMaterialSnapshot(fixture(), "native", undefined, { sourceWidth: 900, sourceHeight: 600 });
    expect(snapshot.payload).toMatchObject({ kind: "image", component: { kind: "image", name: "日落",
      images: [{ caption: "逆光人像", frameWidth: 300, frameHeight: 200, sourceWidth: 900, sourceHeight: 600 }] } });
    expect(snapshot.sources).toEqual([{ localImageId: "material-image-1", file: "media/photo.png" }]);
  });

  it("collects a nested native image without including its surrounding text", () => {
    const plan = fixture();
    const [native] = plan.document.blocks.splice(1, 1);
    plan.document.blocks[0].children = [native];
    const snapshot = createImageMaterialSnapshot(plan, "native", undefined, { sourceWidth: 900, sourceHeight: 600 });
    expect(snapshot.payload.kind).toBe("image");
    expect(snapshot.sources).toHaveLength(1);
    expect(JSON.stringify(snapshot.payload)).not.toContain("anchor");
  });

  it("collects only the selected reference and reuses it with new identities and files", () => {
    const plan = fixture();
    const before = structuredClone(plan);
    const snapshot = createImageMaterialSnapshot(plan, "group-block", "two");
    expect(snapshot.sources).toEqual([{ localImageId: "material-image-1", file: "references/two.png" }]);
    let id = 0;
    const instance = instantiateMaterial(snapshot.payload, [{ localImageId: "material-image-1", file: "media/copied.png" }], () => `fresh-${++id}`);
    const inserted = insertMaterialIntoPlan(plan, instance, "anchor");
    expect(instance.block).toMatchObject({ type: "image", props: {
      url: "media/copied.png", name: "two", caption: "two", previewWidth: 220, showPreview: true,
    } });
    expect(instance.imageGroup).toBeUndefined();
    expect(inserted.imageGroups).toEqual(plan.imageGroups);
    expect(inserted.document.blocks[1].id).toBe(instance.block.id);
    expect(plan).toEqual(before);
    const draft = createMaterialEditDraft(snapshot.payload, () => `edit-${++id}`);
    expect(serializeMaterialEditDraft(draft.plan, draft)).toEqual(snapshot.payload);
  });

  it("inserts native image materials after the selected row and rejects reused native files", () => {
    const plan = fixture();
    const snapshot = createImageMaterialSnapshot(plan, "native", undefined, { sourceWidth: 900, sourceHeight: 600 });
    let id = 0;
    const create = (file: string) => instantiateMaterial(snapshot.payload,
      [{ localImageId: "material-image-1", file }], () => `inserted-${++id}`);
    const instance = create("media/independent.png");
    const next = insertMaterialIntoPlan(plan, instance, "native");
    expect(next.document.blocks[2]).toMatchObject({ type: "image", props: {
      url: "media/independent.png", caption: "逆光人像", previewWidth: 300,
    } });
    expect(next.imageGroups).toEqual(plan.imageGroups);
    expect(() => insertMaterialIntoPlan(plan, create("media/PHOTO.png"), null)).toThrow(/newly copied/);
    expect(() => create("references/wrong.png")).toThrow();
  });

  it("rejects remote files, wrong owners and more than one image", () => {
    const plan = fixture();
    plan.document.blocks[1].props.url = "https://example.com/photo.png";
    expect(() => createImageMaterialSnapshot(plan, "native", undefined, { sourceWidth: 900, sourceHeight: 600 })).toThrow();
    expect(() => createImageMaterialSnapshot(plan, "group-block", "foreign")).toThrow();
    const payload = createImageMaterialSnapshot(fixture(), "group-block", "one").payload;
    if (payload.component.kind !== "image") throw new Error("fixture");
    payload.component.images.push({ ...payload.component.images[0], localImageId: "second" });
    expect(() => validateMaterialPayload(payload)).toThrow();
  });
});
