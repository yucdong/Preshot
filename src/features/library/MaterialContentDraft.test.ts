import { describe, expect, it, vi } from "vitest";
import type { MaterialDetail, MaterialEditImage } from "../../domain/library/models";
import { componentImages } from "../../domain/library/materialStructure";
import { MaterialContentDraft } from "./MaterialContentDraft";

const source = "data:image/png;base64,AA";
function material(): MaterialDetail {
  return {
    id: "material", kind: "imageGroup", revision: 1, metadataVersion: 1,
    name: "素材", description: "", tags: [], favorite: false,
    createdAt: 1, updatedAt: 1, deletedAt: null, imageCount: 2, byteLength: 2,
    previewState: "pending",
    payload: { format: "preshot-material", version: 1, kind: "imageGroup",
      component: { kind: "imageGroup", name: "参考", description: "", images:
        ["original-b", "original-a"].map((localImageId) => ({
          localImageId, aspectRatio: 1.5, frameWidth: 240, frameHeight: 160,
        })) } },
    images: ["original-b", "original-a"].map((localImageId) => ({
      localImageId, blobId: localImageId, mimeType: "image/png", byteLength: 1,
      width: 900, height: 600,
    })),
  };
}
const staged: MaterialEditImage = {
  localImageId: "staged-added", mimeType: "image/png", byteLength: 1,
  width: 300, height: 200, dataUrl: source,
};

describe("MaterialContentDraft", () => {
  it("keeps reorder/import/remove/crop and history isolated with synchronous native-token payloads", () => {
    const original = material();
    const unchanged = structuredClone(original);
    const onChange = vi.fn();
    const draft = new MaterialContentDraft(original,
      new Map(original.images.map((image) => [image.localImageId, source])), onChange);
    const group = draft.getSnapshot().groups[0];
    const [first, second] = group.images;
    draft.moveImage(group.id, first.id, group.id, 1);
    const ids = () => componentImages(draft.readPayload().component).map(({ localImageId }) => localImageId);
    expect(ids()).toEqual(["original-a", "original-b"]);
    draft.addImages(group.id, [staged]);
    const added = draft.getSnapshot().groups[0].images[2];
    draft.replaceImage(group.id, added.id, { ...staged, localImageId: "staged-crop", width: 100 });
    expect(ids()).toEqual(["original-a", "original-b", "staged-crop"]);
    draft.removeImage(group.id, second.id);
    expect(ids()).toEqual(["original-b", "staged-crop"]);
    draft.undo();
    draft.undo();
    expect(ids()).toEqual(["original-a", "original-b", "staged-added"]);
    draft.redo();
    expect(ids()).toEqual(["original-a", "original-b", "staged-crop"]);
    expect(onChange).toHaveBeenLastCalledWith(draft.readPayload());
    expect(original).toEqual(unchanged);
    expect(draft.getSnapshot().plan.document.blocks).toHaveLength(1);
  });

  it("rejects foreign collection moves and reused staging tokens without advancing history", () => {
    const original = material();
    const draft = new MaterialContentDraft(original,
      new Map(original.images.map((image) => [image.localImageId, source])), vi.fn());
    const group = draft.getSnapshot().groups[0];
    expect(() => draft.moveImage(group.id, group.images[0].id, "foreign", 0)).toThrow();
    expect(() => draft.addImages(group.id, [{ ...staged, localImageId: "original-a" }])).toThrow();
    expect(draft.getSnapshot().canUndo).toBe(false);
    expect(draft.readPayload()).toEqual(original.payload);
  });
});
