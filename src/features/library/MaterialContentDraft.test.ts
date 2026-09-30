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
  it("uses EXIF display dimensions for new imports while preserving raw originals and legacy crops", () => {
    const original = material();
    const before = structuredClone(original);
    const draft = new MaterialContentDraft(original, new Map(original.images.map(image => [image.localImageId, source])), vi.fn());
    const group = draft.getSnapshot().groups[0];
    const imported = { ...staged, width: 80, height: 40, displayWidth: 40, displayHeight: 80, presentationAxes: "exif" as const };
    draft.addImages(group.id, [imported]);
    expect(draft.getSnapshot().plan.schemaVersion).toBe(18);
    const added = draft.getSnapshot().groups[0].images.at(-1)!;
    expect(added).toMatchObject({ presentationAxes: "exif", sourceWidth: 40, sourceHeight: 80, aspectRatio: 0.5 });
    expect(added.frameWidth / added.frameHeight).toBe(0.5);
    expect(imported).toMatchObject({ width: 80, height: 40 });
    const saved = draft.readPayload();
    expect(componentImages(saved.component).at(-1)).toMatchObject({ presentationAxes: "exif", sourceWidth: 40, sourceHeight: 80 });
    const reopened = new MaterialContentDraft({ ...original, payload: saved, imageCount: 3, images: [...original.images,
      { localImageId: imported.localImageId, width: imported.width, height: imported.height, mimeType: imported.mimeType,
        byteLength: imported.byteLength, blobId: "unchanged-original-hash" }] },
    new Map([...original.images.map(image => [image.localImageId, source] as const), [imported.localImageId, source]]), vi.fn());
    const reopenedImage = reopened.getSnapshot().groups[0].images.at(-1)!;
    expect(reopened.getDimensions(reopenedImage.file)).toEqual({ width: 40, height: 80 });
    expect(reopened.getSnapshot().sources[`${reopenedImage.file}#preshot-exif`]).toBe(source);
    draft.undo();
    expect(draft.readPayload()).toEqual(original.payload);
    expect(draft.getSnapshot().plan.schemaVersion).toBe(18);
    draft.redo();
    expect(draft.readPayload()).toEqual(saved);
    expect(original).toEqual(before);
  });

  it("retains EXIF axes and crop when reusing selected library images", () => {
    const original = material();
    const draft = new MaterialContentDraft(original, new Map(original.images.map(image => [image.localImageId, source])), vi.fn());
    const visual = { localImageId: "source-exif", presentationAxes: "exif" as const,
      aspectRatio: 0.5, sourceWidth: 40, sourceHeight: 80, frameWidth: 100, frameHeight: 200,
      crop: { x: 0, y: 0.2, width: 0.5, height: 0.5 } };
    const imported = { ...staged, width: 80, height: 40, displayWidth: 40, displayHeight: 80, presentationAxes: "exif" as const };
    draft.addImages(draft.getSnapshot().groups[0].id, [imported], [visual]);
    expect(componentImages(draft.readPayload().component).at(-1)).toEqual({ ...visual, localImageId: staged.localImageId });
  });

  it("uses replacement display dimensions and clears EXIF axes after a normalized crop", () => {
    const original = material();
    const draft = new MaterialContentDraft(original, new Map(original.images.map(image => [image.localImageId, source])), vi.fn());
    const group = draft.getSnapshot().groups[0];
    const id = group.images[0].id;
    draft.replaceImage(group.id, id, { ...staged, width: 80, height: 40, displayWidth: 40, displayHeight: 80, presentationAxes: "exif" });
    expect(draft.getSnapshot().groups[0].images[0]).toMatchObject({ presentationAxes: "exif", aspectRatio: 0.5, sourceWidth: 40, sourceHeight: 80 });
    draft.replaceImage(group.id, id, { ...staged, localImageId: "normalized-crop", width: 20, height: 80 });
    expect(draft.getSnapshot().groups[0].images[0]).toMatchObject({ presentationAxes: "raw", aspectRatio: 0.25, sourceWidth: 20, sourceHeight: 80 });
    draft.undo();
    expect(draft.getSnapshot().groups[0].images[0].presentationAxes).toBe("exif");
    expect(draft.getSnapshot().plan.schemaVersion).toBe(18);
  });

  it("fits new wide captures to the gallery without changing original dimensions or older frames", () => {
    const original = material();
    const draft = new MaterialContentDraft(original, new Map(original.images.map(image => [image.localImageId, source])), vi.fn());
    const group = draft.getSnapshot().groups[0];
    draft.addImages(group.id, [{ ...staged, width: 3000, height: 500 }], undefined, 600);
    const images = draft.getSnapshot().groups[0].images;
    expect(images.at(-1)).toMatchObject({ sourceWidth: 3000, sourceHeight: 500,
      frameWidth: 600, frameHeight: 100, aspectRatio: 6 });
    expect(images[0].frameWidth).toBe(group.images[0].frameWidth);
    draft.undo();
    expect(draft.readPayload()).toEqual(original.payload);
  });
  it("appends selected library images with independent identities, presentation and one undo step", () => {
    const original = material();
    const draft = new MaterialContentDraft(original, new Map(original.images.map((image) => [image.localImageId, source])), vi.fn());
    const group = draft.getSnapshot().groups[0];
    const copies = [staged, { ...staged, localImageId: "another-copy" }];
    const visuals = copies.map((_, index) => ({ localImageId: `source-${index}`, caption: `caption-${index}`,
      aspectRatio: 1.5, frameWidth: 150, frameHeight: 100, fitMode: "stretch" as const,
      crop: { x: 0, y: 0, width: 0.5, height: 1 } }));
    draft.addImages(group.id, copies, visuals);
    const inserted = draft.readPayload();
    expect(componentImages(inserted.component).slice(2)).toEqual(visuals.map((image, index) => ({ ...image, localImageId: copies[index].localImageId })));
    expect(draft.getSnapshot().groups[0].images).toHaveLength(4);
    draft.undo();
    expect(draft.readPayload()).toEqual(original.payload);
    draft.redo();
    expect(draft.readPayload()).toEqual(inserted);
    expect(original.images).toHaveLength(2);
  });
  it("keeps an image material to one image across replacement and undo", () => {
    const original = material();
    original.kind = "image";
    original.payload = { ...original.payload, kind: "image", component: {
      kind: "image", name: "图片", description: "", images: componentImages(original.payload.component).slice(0, 1),
    } };
    original.images = original.images.slice(0, 1);
    const draft = new MaterialContentDraft(original, new Map([[original.images[0].localImageId, source]]), vi.fn());
    const group = draft.getSnapshot().groups[0];
    expect(() => draft.addImages(group.id, [staged])).toThrow("一张图片");
    expect(draft.getSnapshot().canUndo).toBe(false);
    draft.removeImage(group.id, group.images[0].id);
    draft.addImages(group.id, [staged]);
    expect(draft.readPayload().kind).toBe("image");
    expect(componentImages(draft.readPayload().component)).toHaveLength(1);
    draft.undo();
    draft.undo();
    expect(draft.readPayload()).toEqual(original.payload);
  });
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

  it("pastes a new image after the selected image in one undo step", () => {
    const original = material();
    const draft = new MaterialContentDraft(original,
      new Map(original.images.map((image) => [image.localImageId, source])), vi.fn());
    const group = draft.getSnapshot().groups[0];
    const pasted = draft.pasteImage(group.id, group.images[0].id, staged, {
      aspectRatio: 1.5, frameWidth: 240, frameHeight: 160, fitMode: "stretch",
    });
    expect(draft.getSnapshot().groups[0].images[1]).toMatchObject({ id: pasted.id, fitMode: "stretch" });
    expect(componentImages(draft.readPayload().component).map(image => image.localImageId))
      .toEqual(["original-b", staged.localImageId, "original-a"]);
    draft.undo();
    expect(draft.readPayload()).toEqual(original.payload);
    draft.redo();
    expect(draft.getSnapshot().groups[0].images[1]).toEqual(pasted);
    expect(draft.getSnapshot().plan.document.blocks).toHaveLength(1);
  });
});
