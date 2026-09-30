import { describe, expect, it } from "vitest";
import { createEmptyProjectPlanV17, promoteImagePresentationPlan, validateProjectPlanV17 } from "./blockDocument";
import { createMaterialSnapshot, insertMaterialIntoPlan, instantiateMaterial } from "../../library/material";
import { validateMaterialPayload } from "../../library/validation";

describe("EXIF document compatibility", () => {
  it("preserves unmarked documents and promotes native-image-only documents before persistence", () => {
    const plan = createEmptyProjectPlanV17("Portrait", { makeId: () => "row" });
    plan.document.blocks = [{ id: "photo", type: "image", children: [], content: undefined,
      props: { url: "media/portrait.jpg", name: "Portrait", caption: "", showPreview: true } }];
    expect(promoteImagePresentationPlan(plan)).toBe(plan);
    expect(validateProjectPlanV17(plan).schemaVersion).toBe(17);
    plan.document.blocks[0].props.presentationAxes = "exif";
    const promoted = promoteImagePresentationPlan(plan);
    expect(promoted.schemaVersion).toBe(18);
    expect(promoted.document).toBe(plan.document);
    expect(promoted.document.version).toBe(5);
    expect(plan.schemaVersion).toBe(17);
    expect(validateProjectPlanV17(promoted)).toEqual(promoted);
    expect(promoteImagePresentationPlan({ ...promoted, document: { ...promoted.document, blocks: [] } }).schemaVersion).toBe(18);
  });

  it("preserves raw crops and EXIF views through material snapshots and independent insertion", () => {
    const plan = createEmptyProjectPlanV17("Portrait", { makeId: () => "row" });
    plan.document.blocks = [{ id: "row", type: "prop", props: { artifactId: "prop" }, content: undefined, children: [] }];
    const raw = { id: "raw", file: "references/0001.jpg", aspectRatio: 2, sourceWidth: 80, sourceHeight: 40,
      frameWidth: 200, frameHeight: 100, crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.5 } };
    const exif = { ...raw, id: "exif", file: "references/0002.jpg", presentationAxes: "exif" as const,
      aspectRatio: 0.5, sourceWidth: 40, sourceHeight: 80, frameWidth: 100, frameHeight: 200 };
    plan.artifacts = [{ id: "prop", kind: "prop", revision: 0, title: "Camera", source: "",
      gallery: { id: "gallery", images: [raw, exif] } }];
    const promoted = validateProjectPlanV17(plan);
    expect(promoted.schemaVersion).toBe(18);
    expect(promoted.artifacts[0].kind === "prop" && promoted.artifacts[0].gallery.images[0]).toEqual(raw);
    const snapshot = createMaterialSnapshot(promoted, "row");
    let sequence = 0;
    const instance = instantiateMaterial(snapshot.payload, snapshot.sources.map((source, index) => ({
      localImageId: source.localImageId, file: `references/copied-${index}.jpg`,
    })), () => `fresh-${++sequence}`);
    if (instance.artifact?.kind !== "prop") throw new Error("Expected prop material");
    expect(instance.artifact.gallery.images[0]).not.toHaveProperty("presentationAxes");
    expect(instance.artifact.gallery.images[0].crop).toEqual(raw.crop);
    expect(instance.artifact.gallery.images[1]).toMatchObject({ presentationAxes: "exif", sourceWidth: 40, sourceHeight: 80, crop: exif.crop });
    const target = createEmptyProjectPlanV17("Target", { makeId: () => "anchor" });
    const inserted = insertMaterialIntoPlan(target, instance, "anchor");
    expect(inserted.schemaVersion).toBe(18);
    expect(target.schemaVersion).toBe(17);
    expect(() => validateMaterialPayload({ ...snapshot.payload, version: 1 })).toThrow("EXIF");
  });

  it("promotes a native image material insertion without rewriting the source plan", () => {
    const target = createEmptyProjectPlanV17("Target", { makeId: () => "anchor" });
    const before = structuredClone(target);
    const image = { localImageId: "portrait", presentationAxes: "exif" as const,
      aspectRatio: 0.5, sourceWidth: 40, sourceHeight: 80, frameWidth: 100, frameHeight: 200,
      crop: { x: 0, y: 0.25, width: 1, height: 0.5 } };
    const instance = instantiateMaterial({ format: "preshot-material", version: 2, kind: "image",
      component: { kind: "image", name: "Portrait", description: "", images: [image] } },
    [{ localImageId: image.localImageId, file: "media/fresh-portrait.jpg" }], () => "fresh-portrait");
    const inserted = insertMaterialIntoPlan(target, instance, "anchor");
    expect(inserted.schemaVersion).toBe(18);
    expect(inserted.document.blocks[1]).toMatchObject({ id: "fresh-portrait", type: "image",
      props: { url: "media/fresh-portrait.jpg", presentationAxes: "exif", cropY: 0.25, cropHeight: 0.5 } });
    expect(target).toEqual(before);
  });
});
