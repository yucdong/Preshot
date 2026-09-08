import { describe, expect, it } from "vitest";
import {
  artifactCollectionsInPlan,
  createEmptyProjectPlanV15,
  validateProjectPlanV15,
  type ArtifactRecord,
  type ProjectPlanV15,
  type PreshotBlock,
} from "../plan/canvas/blockDocument";
import type { ReferenceImage } from "../plan/canvas/models";
import {
  createMaterialSnapshot,
  insertMaterialIntoPlan,
  instantiateMaterial,
  materialPayloadText,
  materialPayloadTitle,
  validateMaterialMetadata,
  validateMaterialPayload,
  type MaterialInstance,
} from "./index";
import { MATERIAL_KINDS, type MaterialKind, type MaterialPayload } from "./models";

function image(id: string): ReferenceImage {
  return {
    id,
    file: `references/${id}.png`,
    caption: `说明 ${id}`,
    aspectRatio: 1.5,
    sourceWidth: 900,
    sourceHeight: 600,
    frameWidth: 251,
    frameHeight: 173,
    frameOffsetX: -18,
    frameOffsetY: 23,
    fitMode: "stretch",
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
  };
}

function paragraph(id: string, children: PreshotBlock[] = []): PreshotBlock {
  return { id, type: "paragraph", props: {}, content: [], children };
}

function sourcePlan(kind: MaterialKind): ProjectPlanV15 {
  const plan = createEmptyProjectPlanV15("原方案", { makeId: () => "anchor" });
  const images = [image("original-one"), image("original-two")];
  if (kind === "imageGroup") {
    plan.imageGroups = [{
      id: "original-group", type: "reference", name: "保存的标题",
      description: "图片组介绍", x: 23, width: 410, height: 777,
      frameOffsetY: -13, images,
    }];
    plan.document.blocks.push({
      id: "source-block", type: kind, props: { groupId: "original-group" },
      content: undefined, children: [],
    });
    return plan;
  }
  const base = {
    id: "original-artifact", revision: 14,
    layout: { widthRatio: 0.6, offsetRatio: 0.2, minHeight: 400 },
  };
  const collection = { id: "original-collection", images };
  const artifact: ArtifactRecord = kind === "shootingLocation"
    ? { ...base, kind, venueName: "保存的标题", address: "拍摄地址",
      description: "场地描述", gallery: collection }
    : kind === "modelCard"
      ? { ...base, kind, modelId: "保存的标题", heightCm: 178.5, weightKg: 59,
        shoeSize: "39", notes: "模特补充", samples: collection }
      : kind === "prop"
        ? { ...base, kind, title: "保存的标题", source: "道具信息", gallery: collection }
        : { ...base, kind, title: "保存的标题", source: "服装信息",
          mainGallery: collection,
          tryOn: { expanded: true, gallery: {
            id: "original-try-on", images: [image("legacy-hidden")],
          } } };
  plan.artifacts.push(artifact);
  plan.document.blocks.push({
    id: "source-block", type: kind, props: { artifactId: artifact.id },
    content: undefined, children: [],
  });
  return plan;
}

function payload(kind: MaterialKind = "imageGroup"): MaterialPayload {
  return createMaterialSnapshot(sourcePlan(kind), "source-block").payload;
}

function newInstance(kind: MaterialKind = "imageGroup", prefix = "new"): MaterialInstance {
  const snapshot = createMaterialSnapshot(sourcePlan(kind), "source-block");
  let id = 0;
  return instantiateMaterial(snapshot.payload, snapshot.sources.map((source, index) => ({
    localImageId: source.localImageId, file: `references/${prefix}-${index}.png`,
  })), () => `${prefix}-${++id}`);
}

function allImages(instance: MaterialInstance): ReferenceImage[] {
  return instance.imageGroup?.images ??
    artifactCollectionsInPlan({
      artifacts: instance.artifact ? [instance.artifact] : [],
    } as ProjectPlanV15).flatMap(({ images }) => images);
}

describe("material snapshots and insertion", () => {
  it.each(MATERIAL_KINDS)("roundtrips %s with fresh identities and preserved visual data", (kind) => {
    const plan = sourcePlan(kind);
    const original = structuredClone(plan);
    const snapshot = createMaterialSnapshot(plan, "source-block");
    expect(validateMaterialPayload(snapshot.payload)).toEqual(snapshot.payload);
    expect(materialPayloadTitle(snapshot.payload)).toBe("保存的标题");
    expect(JSON.stringify(snapshot.payload)).not.toMatch(/"original-[^"]*"|references\/|legacy-hidden/);
    expect(snapshot.sources).toEqual([
      { localImageId: snapshot.sources[0].localImageId, file: "references/original-one.png" },
      { localImageId: snapshot.sources[1].localImageId, file: "references/original-two.png" },
    ]);
    const instance = newInstance(kind);
    const target = createEmptyProjectPlanV15("新方案", { makeId: () => "target-anchor" });
    const inserted = insertMaterialIntoPlan(target, instance, "target-anchor");
    expect(validateProjectPlanV15(inserted)).toEqual(inserted);
    expect(inserted.document.blocks.map(({ id }) => id)).toEqual(["target-anchor", instance.block.id]);
    const resaved = createMaterialSnapshot(inserted, instance.block.id);
    expect(resaved.payload).toEqual(snapshot.payload);
    expect(resaved.omittedLegacyImages).toBe(0);
    expect(allImages(instance).map(({ file }) => file)).toEqual([
      "references/new-0.png", "references/new-1.png",
    ]);
    allImages(instance).forEach((entry, index) => {
      const { id: oldId, file: oldFile, ...visual } = image(index ? "original-two" : "original-one");
      expect(entry.id).not.toBe(oldId);
      expect(entry.file).not.toBe(oldFile);
      expect(entry).toMatchObject(visual);
    });
    expect(plan).toEqual(original);
    expect(target.document.blocks).toHaveLength(1);
  });

  it("strips whole-container geometry, resets revision and creates a fresh empty try-on", () => {
    const group = newInstance().imageGroup!;
    expect(group).toMatchObject({ x: 0, width: 1008, height: 320 });
    expect(group).not.toHaveProperty("frameOffsetY");
    const clothing = newInstance("clothing").artifact!;
    expect(clothing).not.toHaveProperty("layout");
    expect(clothing.revision).toBe(0);
    if (clothing.kind !== "clothing") throw new Error("Wrong fixture");
    expect(clothing.tryOn).toMatchObject({ expanded: false, gallery: { images: [] } });
    const ids = [
      clothing.id, clothing.mainGallery.id, clothing.tryOn.gallery.id,
      ...clothing.mainGallery.images.map(({ id }) => id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(createMaterialSnapshot(sourcePlan("clothing"), "source-block")
      .omittedLegacyImages).toBe(1);
  });

  it.each(MATERIAL_KINDS)("supports empty %s galleries", (kind) => {
    const plan = sourcePlan(kind);
    plan.imageGroups.forEach((group) => { group.images = []; });
    artifactCollectionsInPlan(plan).forEach((collection) => { collection.images = []; });
    const snapshot = createMaterialSnapshot(plan, "source-block");
    let id = 0;
    expect(allImages(instantiateMaterial(snapshot.payload, [], () => `empty-${++id}`))).toEqual([]);
  });

  it("indexes every text field, including model measurements and optional captions", () => {
    const expectations = {
      imageGroup: ["保存的标题", "图片组介绍"],
      shootingLocation: ["保存的标题", "拍摄地址", "场地描述"],
      modelCard: ["保存的标题", "178.5", "59", "39", "模特补充"],
      prop: ["保存的标题", "道具信息"],
      clothing: ["保存的标题", "服装信息"],
    };
    for (const kind of MATERIAL_KINDS) {
      const text = materialPayloadText(payload(kind));
      for (const field of [...expectations[kind], "说明 original-one", "说明 original-two"]) {
        expect(text).toContain(field);
      }
      expect(text).not.toContain("legacy-hidden");
    }
  });

  it("returns detached data at every ownership boundary", () => {
    const original = sourcePlan("prop");
    const snapshot = createMaterialSnapshot(original, "source-block");
    const parsed = validateMaterialPayload(snapshot.payload);
    expect(parsed).not.toBe(snapshot.payload);
    if (parsed.component.kind !== "prop" || snapshot.payload.component.kind !== "prop") {
      throw new Error("Wrong fixture");
    }
    parsed.component.gallery.images[0].crop!.x = 0;
    expect(snapshot.payload.component.gallery.images[0].crop!.x).toBe(0.1);
    snapshot.payload.component.gallery.images[0].crop!.x = 0;
    expect(artifactCollectionsInPlan(original)[0].images[0].crop!.x).toBe(0.1);
    const instance = newInstance("prop");
    const inserted = insertMaterialIntoPlan(original, instance, null);
    allImages(instance)[0].crop!.x = 0;
    expect(artifactCollectionsInPlan(inserted)[1].images[0].crop!.x).toBe(0.1);
  });

  it("inserts after a nested anchor's top-level ancestor and prepends when no cursor exists", () => {
    const plan = createEmptyProjectPlanV15("目标", { makeId: () => "parent" });
    plan.document.blocks[0].children = [paragraph("child", [paragraph("grandchild")])];
    plan.document.blocks.push(paragraph("last"));
    const instance = newInstance();
    expect(insertMaterialIntoPlan(plan, instance, "grandchild").document.blocks.map(({ id }) => id))
      .toEqual(["parent", instance.block.id, "last"]);
    expect(insertMaterialIntoPlan(plan, instance, null).document.blocks.map(({ id }) => id))
      .toEqual([instance.block.id, "parent", "last"]);
    expect(() => insertMaterialIntoPlan(plan, instance, "deleted-anchor")).toThrow(/anchor/i);
  });

  it("rejects unsupported selections, children, missing sidecars and invalid complete plans", () => {
    expect(() => createMaterialSnapshot(sourcePlan("prop"), "anchor")).toThrow();
    expect(() => createMaterialSnapshot(sourcePlan("prop"), "missing")).toThrow();
    const child = sourcePlan("prop");
    child.document.blocks[1].children.push(paragraph("child"));
    expect(() => createMaterialSnapshot(child, "source-block")).toThrow();
    const missing = sourcePlan("prop");
    missing.artifacts = [];
    expect(() => createMaterialSnapshot(missing, "source-block")).toThrow();
    const invalid = sourcePlan("prop");
    invalid.document.blocks.push({ ...invalid.document.blocks[1], id: "duplicate-marker" });
    expect(() => insertMaterialIntoPlan(invalid, newInstance(), null)).toThrow();
  });

  it("rejects identity collisions across all inserted namespaces and existing files", () => {
    const plan = sourcePlan("prop");
    const blockCollision = newInstance();
    blockCollision.block.id = "anchor";
    expect(() => insertMaterialIntoPlan(plan, blockCollision, null)).toThrow(/id|identity|collision/i);
    const crossNamespace = newInstance();
    crossNamespace.imageGroup!.images[0].id = "original-collection";
    expect(() => insertMaterialIntoPlan(plan, crossNamespace, null)).toThrow(/id|identity|collision/i);
    const fileCollision = newInstance();
    fileCollision.imageGroup!.images[0].file = "references/ORIGINAL-ONE.PNG";
    expect(() => insertMaterialIntoPlan(plan, fileCollision, null)).toThrow(/file/i);
    const withinInstance = newInstance();
    withinInstance.imageGroup!.images[0].id = withinInstance.block.id;
    expect(() => insertMaterialIntoPlan(plan, withinInstance, null)).toThrow(/id|identity|collision/i);
    const snapshot = createMaterialSnapshot(plan, "source-block");
    expect(() => instantiateMaterial(snapshot.payload, snapshot.sources, () => "repeated"))
      .toThrow(/id|identity|unique/i);
  });

  it("enforces exact source bijection but permits repeated blobs within an insertion", () => {
    const snapshot = createMaterialSnapshot(sourcePlan("prop"), "source-block");
    let id = 0;
    const makeId = () => `fresh-${++id}`;
    const sources = snapshot.sources;
    expect(() => instantiateMaterial(snapshot.payload, sources.slice(1), makeId)).toThrow();
    expect(() => instantiateMaterial(snapshot.payload, [...sources, sources[0]], makeId)).toThrow();
    expect(() => instantiateMaterial(snapshot.payload, [sources[0], sources[0]], makeId)).toThrow();
    expect(() => instantiateMaterial(snapshot.payload, [sources[0], {
      ...sources[1], localImageId: "unknown",
    }], makeId)).toThrow();
    const shared = sources.map((entry) => ({ ...entry, file: "references/shared.png" }));
    expect(allImages(instantiateMaterial(snapshot.payload, shared, makeId)))
      .toHaveLength(2);
    const reversed = instantiateMaterial(snapshot.payload, [...sources].reverse(), makeId);
    expect(allImages(reversed).map(({ file }) => file)).toEqual(sources.map(({ file }) => file));
  });

  it("enforces full-plan artifact limits before publication", () => {
    const target = createEmptyProjectPlanV15("目标", { makeId: () => "anchor" });
    for (let index = 0; index < 512; index++) {
      const artifact: ArtifactRecord = {
        id: `artifact-${index}`, revision: 0, kind: "prop", title: "道具",
        source: "", gallery: { id: `gallery-${index}`, images: [] },
      };
      target.artifacts.push(artifact);
      target.document.blocks.push({
        id: `block-${index}`, type: "prop", props: { artifactId: artifact.id },
        content: undefined, children: [],
      });
    }
    expect(validateProjectPlanV15(target)).toEqual(target);
    expect(() => insertMaterialIntoPlan(target, newInstance("prop"), null)).toThrow(/512/);
    expect(target.artifacts).toHaveLength(512);
  });

  it.each([
    "../escape.png", "references/../escape.png", "references\\escape.png",
    "C:\\secret.png", "https://example.test/image.png", "data:image/png;base64,AA",
    "references/..", "references/NUL.png", "references/a.png:stream",
    "references/a.png ", "references/%2e%2e.png", "references/a.svg",
    "references/a\u0000.png",
  ])("rejects dangerous or unsupported source path %s", (file) => {
    const plan = sourcePlan("imageGroup");
    plan.imageGroups[0].images[0].file = file;
    expect(() => createMaterialSnapshot(plan, "source-block")).toThrow();
    const snapshot = createMaterialSnapshot(sourcePlan("prop"), "source-block");
    snapshot.sources[0].file = file;
    expect(() => instantiateMaterial(snapshot.payload, snapshot.sources, () => "unused")).toThrow();
  });
});

describe("material payload validation", () => {
  it.each([
    (value: Record<string, unknown>) => { value.version = 2; },
    (value: Record<string, unknown>) => { value.kind = "paragraph"; },
    (value: Record<string, unknown>) => { value.kind = "prop"; },
    (value: Record<string, unknown>) => { value.file = "references/secret.png"; },
    (value: Record<string, unknown>) => { value.children = []; },
    (value: Record<string, unknown>) => { value.format = "preshot-blocks"; },
  ])("rejects unsupported headers and unknown keys", (mutate) => {
    const value = structuredClone(payload()) as unknown as Record<string, unknown>;
    mutate(value);
    expect(() => validateMaterialPayload(value)).toThrow();
  });

  it("rejects source identities, layouts, extra collections, executable objects and cycles", () => {
    const valid = payload();
    if (valid.component.kind !== "imageGroup") throw new Error("Wrong fixture");
    const image = valid.component.images[0];
    for (const extra of [
      { id: "source" }, { x: 1 }, { width: 10 }, { layout: {} },
      { children: [] }, { constructor: "unsafe" },
    ]) {
      expect(() => validateMaterialPayload({
        ...valid, component: { ...valid.component, ...extra },
      })).toThrow();
    }
    for (const extra of [{ id: "source" }, { file: "references/source.png" },
      { url: "https://example.test" }, { localImageId: "../bad" }]) {
      expect(() => validateMaterialPayload({
        ...valid, component: {
          ...valid.component, images: [{ ...image, ...extra }],
        },
      })).toThrow();
    }
    const clothing = payload("clothing");
    expect(() => validateMaterialPayload({
      ...clothing, component: { ...clothing.component, tryOn: { images: [] } },
    })).toThrow();
    expect(() => validateMaterialPayload(Object.assign(Object.create({ inherited: true }), valid)))
      .toThrow();
    expect(() => validateMaterialPayload({ ...valid, toJSON: () => valid })).toThrow();
    const cyclic: Record<string, unknown> = { ...valid };
    cyclic.component = cyclic;
    expect(() => validateMaterialPayload(cyclic)).toThrow();
  });

  it.each([
    { frameWidth: 0 }, { sourceWidth: 1.5 }, { aspectRatio: Infinity },
    { fitMode: "contain" }, { caption: 4 },
    { crop: { x: 0.8, y: 0, width: 0.5, height: 1 } },
    { crop: { x: 0, y: 0, width: 1, height: 1, url: "file://" } },
  ])("uses active v15 image validation for %j", (change) => {
    const valid = payload();
    if (valid.component.kind !== "imageGroup") throw new Error("Wrong fixture");
    const image = valid.component.images[0];
    expect(() => validateMaterialPayload({
      ...valid,
      component: { ...valid.component, images: [{ ...image, ...change }] },
    })).toThrow();
  });

  it("enforces unique portable image IDs and bounded image, text and UTF-8 JSON sizes", () => {
    const valid = payload();
    if (valid.component.kind !== "imageGroup") throw new Error("Wrong fixture");
    const entry = valid.component.images[0];
    expect(() => validateMaterialPayload({
      ...valid, component: { ...valid.component, images: [entry, entry] },
    })).toThrow();
    expect(() => validateMaterialPayload({
      ...valid, component: { ...valid.component, images: Array.from({ length: 129 },
        (_, index) => ({ ...entry, localImageId: `image-${index}` })) },
    })).toThrow(/128|image|limit/i);
    expect(() => validateMaterialPayload({
      ...valid, component: { ...valid.component, description: "字".repeat(200_001) },
    })).toThrow(/text|200000|200,000|limit/i);
    expect(() => validateMaterialPayload({
      ...valid, component: { ...valid.component, description: "\u0000".repeat(180_000) },
    })).toThrow(/byte|MiB|JSON|payload/i);
    const unicode = { ...valid, component: {
      ...valid.component, name: "😀".repeat(199_998), description: "", images: [],
    } };
    expect(validateMaterialPayload(unicode)).toEqual(unicode);
    const maximum = {
      ...valid,
      component: {
        ...valid.component,
        images: Array.from({ length: 128 }, (_, index) => ({
          ...entry, localImageId: `image-${index}`,
        })),
      },
    };
    expect(validateMaterialPayload(maximum)).toEqual(maximum);
  });

  it("rejects invalid Unicode and never invokes untrusted object accessors", () => {
    const valid = payload();
    expect(() => validateMaterialPayload({
      ...valid, component: { ...valid.component, name: "\ud800" },
    })).toThrow(/unicode/i);
    let accessed = false;
    const getter = Object.defineProperty({ ...valid }, "component", {
      enumerable: true,
      get() { accessed = true; return valid.component; },
    });
    expect(() => validateMaterialPayload(getter)).toThrow();
    expect(accessed).toBe(false);
  });
});

describe("material metadata", () => {
  it("trims, NFC-normalizes and deduplicates tags without changing component content", () => {
    const metadata = {
      name: "  Cafe\u0301 / 春季  ", description: "  介绍 e\u0301  ",
      tags: [" 人像 ", "人像", "E\u0301", "é"], favorite: true,
    };
    expect(validateMaterialMetadata(metadata)).toEqual({
      name: "Café / 春季", description: "介绍 é",
      tags: ["人像", "É"], favorite: true,
    });
    expect(metadata.tags).toHaveLength(4);
  });

  it.each([
    { name: " " }, { name: "字".repeat(81) }, { name: "a\nb" },
    { description: "字".repeat(1001) }, { tags: [""] },
    { tags: ["字".repeat(25)] }, { tags: ["a\u007fb"] },
    { tags: Array.from({ length: 13 }, (_, index) => `tag${index}`) },
    { favorite: "true" }, { id: "unexpected" },
  ])("rejects invalid metadata %j", (change) => {
    expect(() => validateMaterialMetadata({
      name: "标题", description: "", tags: [], favorite: false, ...change,
    } as never)).toThrow();
  });

  it("counts Unicode code points and allows exact limits", () => {
    const metadata = {
      name: "😀".repeat(80), description: "😀".repeat(1000),
      tags: Array.from({ length: 12 }, (_, index) => `${index}`.padEnd(24, "字")),
      favorite: false,
    };
    expect(validateMaterialMetadata(metadata)).toEqual(metadata);
  });
});
