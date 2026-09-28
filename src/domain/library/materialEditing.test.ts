import { describe, expect, it } from "vitest";
import { MATERIAL_KINDS, type MaterialKind, type MaterialPayload } from "./models";
import { componentImages } from "./materialStructure";
import { createMaterialEditDraft, serializeMaterialEditDraft } from "./materialEditing";

function payload(kind: MaterialKind): MaterialPayload {
  const images = ["native-original-b", "native-original-a"].map((localImageId) => ({
    localImageId, aspectRatio: 1.5, frameWidth: 210, frameHeight: 140,
    sourceWidth: 900, sourceHeight: 600, frameOffsetX: -7, frameOffsetY: 3,
    fitMode: "stretch" as const, crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
  }));
  if (kind === "image") images.splice(1);
  const gallery = { images };
  const component = (kind === "image" || kind === "imageGroup")
    ? { kind, name: "参考", description: "说明", images }
    : kind === "shootingLocation"
      ? { kind, venueName: "场地", address: "地址", description: "说明", gallery }
      : kind === "modelCard"
        ? { kind, modelId: "模特", heightCm: 172, weightKg: 55, shoeSize: "38", samples: gallery }
        : kind === "clothing"
          ? { kind, title: "服装", source: "来源", mainGallery: gallery }
          : { kind, title: "道具", source: "来源", gallery };
  return { format: "preshot-material", version: 1, kind, component };
}

describe("isolated material draft serialization", () => {
  it.each(MATERIAL_KINDS)("roundtrips %s without renumbering native tokens or mutating the original", (kind) => {
    const original = payload(kind);
    const before = structuredClone(original);
    let id = 0;
    const draft = createMaterialEditDraft(original, () => `draft-${++id}`);
    expect(draft.plan.document.blocks).toHaveLength(1);
    expect(serializeMaterialEditDraft(draft.plan, draft)).toEqual(original);
    expect(original).toEqual(before);
    expect(JSON.stringify(draft.plan)).not.toContain("native-original");
  });

  it("preserves source tokens across reorder, addition, removal and crop replacement", () => {
    let id = 0;
    const draft = createMaterialEditDraft(payload("imageGroup"), () => `draft-${++id}`);
    const plan = structuredClone(draft.plan);
    const [first, second] = plan.imageGroups[0].images;
    draft.fileTokens.set("references/0003.png", "staged-added");
    draft.fileTokens.set("references/0004.png", "staged-crop");
    plan.imageGroups[0].images = [
      { ...second, file: "references/0004.png" },
      { ...first, id: "new-image", file: "references/0003.png" },
    ];
    expect(componentImages(serializeMaterialEditDraft(plan, draft).component)
      .map(({ localImageId }) => localImageId)).toEqual(["staged-crop", "staged-added"]);
    expect(serializeMaterialEditDraft(draft.plan, draft)).toEqual(payload("imageGroup"));
  });

  it("rejects foreign tokens, duplicate sources and any changed block/sidecar identity", () => {
    let id = 0;
    const draft = createMaterialEditDraft(payload("imageGroup"), () => `draft-${++id}`);
    const mutate = (change: (plan: typeof draft.plan) => void) => {
      const plan = structuredClone(draft.plan);
      change(plan);
      expect(() => serializeMaterialEditDraft(plan, draft)).toThrow();
    };
    mutate((plan) => { plan.imageGroups[0].images[0].file = "references/rogue.png"; });
    mutate((plan) => { plan.imageGroups[0].images[1].file = plan.imageGroups[0].images[0].file; });
    mutate((plan) => { plan.document.blocks = []; });
    mutate((plan) => { plan.document.blocks.push(structuredClone(plan.document.blocks[0])); });
    mutate((plan) => { plan.document.blocks[0].children = [structuredClone(plan.document.blocks[0])]; });
    mutate((plan) => { plan.document.blocks[0].id = "replacement"; });
    mutate((plan) => { plan.imageGroups[0].id = "replacement"; });
    mutate((plan) => { plan.imageGroups[0].width = 500; });
  });

  it("rejects hidden clothing images and changed collection identities", () => {
    let id = 0;
    const draft = createMaterialEditDraft(payload("clothing"), () => `draft-${++id}`);
    const plan = structuredClone(draft.plan);
    const artifact = plan.artifacts[0];
    if (artifact.kind !== "clothing") throw new Error("Fixture");
    artifact.tryOn.gallery.images = [artifact.mainGallery.images[0]];
    expect(() => serializeMaterialEditDraft(plan, draft)).toThrow();
    artifact.tryOn.gallery.images = [];
    artifact.mainGallery.id = "replacement";
    expect(() => serializeMaterialEditDraft(plan, draft)).toThrow();
  });
});
