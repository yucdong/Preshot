import { describe, expect, it, vi } from "vitest";
import { createEmptyProjectPlanV15, type ProjectPlanV15 } from "../plan/canvas/blockDocument";
import { insertPastedImage, pasteProjectImage, type ImagePasteRepository } from "./projectImagePaste";

function plan(): ProjectPlanV15 {
  return {
    ...createEmptyProjectPlanV15("目标", { makeId: () => "first" }),
    imageGroups: [{
      id: "gallery", type: "reference", name: "参考", description: "",
      x: 0, width: 700, height: 300,
      images: [{ id: "source", file: "references/0001.png", aspectRatio: 1.5, frameWidth: 240, frameHeight: 160 }],
    }],
    document: { format: "preshot-blocks", version: 5, blocks: [
      { id: "first", type: "paragraph", props: {}, content: [{ type: "text", text: "文字保留", styles: {} }], children: [] },
      { id: "group-block", type: "imageGroup", props: { groupId: "gallery" }, content: undefined, children: [] },
    ] },
  };
}
const prepared = { operationId: "operation", file: "references/0002.png", name: "图片.png", mimeType: "image/png" };
const image = { bytes: [1], name: "图片.png", mimeType: "image/png" };

describe("independent project image paste", () => {
  it("inserts after a selected tile, retaining appearance but no source identity or file", () => {
    const before = plan();
    const result = insertPastedImage(before, {
      kind: "gallery", groupId: "gallery", afterImageId: "source",
    }, prepared, { width: 600, height: 400 }, () => "copy", {
      aspectRatio: 1.5, frameWidth: 240, frameHeight: 160, fitMode: "stretch",
    });
    expect(result.plan.imageGroups[0].images.map(entry => entry.id)).toEqual(["source", "copy"]);
    expect(result.plan.imageGroups[0].images[1]).toMatchObject({ file: prepared.file, fitMode: "stretch" });
    expect(result.plan.document).toEqual(before.document);
    expect(before.imageGroups[0].images).toHaveLength(1);
  });

  it.each([null, "first"])("inserts a native image at anchor %s without replacing text", (anchor) => {
    const before = plan();
    const result = insertPastedImage(before, { kind: "document", afterBlockId: anchor },
      { ...prepared, file: "media/new.png" }, { width: 600, height: 400 }, () => "copy");
    expect(result.plan.document.blocks.map(entry => entry.id)).toEqual(anchor
      ? ["first", "copy", "group-block"] : ["copy", "first", "group-block"]);
    expect(result.plan.document.blocks.find(entry => entry.id === "first")).toEqual(before.document.blocks[0]);
  });

  it("rejects disappeared anchors, reused IDs and files before publishing", () => {
    const target = { kind: "gallery" as const, groupId: "gallery", afterImageId: "missing" };
    expect(() => insertPastedImage(plan(), target, prepared, { width: 1, height: 1 }, () => "copy")).toThrow();
    expect(() => insertPastedImage(plan(), { ...target, afterImageId: null }, prepared, { width: 1, height: 1 }, () => "source")).toThrow();
    expect(() => insertPastedImage(plan(), { ...target, afterImageId: null },
      { ...prepared, file: "references/0001.png" }, { width: 1, height: 1 }, () => "copy")).toThrow();
  });

  it.each(["shootingLocation", "modelCard", "prop", "clothing"] as const)("pastes into %s without touching its text or other components", (kind) => {
    const before = plan();
    const gallery = { id: "artifact-gallery", images: [] };
    const base = { id: "artifact", revision: 7 };
    before.artifacts = kind === "shootingLocation"
      ? [{ ...base, kind, venueName: "场地", address: "地址", description: "保留", gallery }]
      : kind === "modelCard"
        ? [{ ...base, kind, modelId: "模特", heightCm: null, weightKg: null, shoeSize: "", notes: "保留", samples: gallery }]
        : kind === "clothing"
          ? [{ ...base, kind, title: "服装", source: "保留", mainGallery: gallery, tryOn: { expanded: false, gallery: { id: "legacy", images: [] } } }]
          : [{ ...base, kind, title: "道具", source: "保留", gallery }];
    before.document.blocks.push({ id: "artifact-block", type: kind, props: { artifactId: "artifact" }, content: undefined, children: [] });
    const result = insertPastedImage(before, { kind: "gallery", groupId: gallery.id, afterImageId: null },
      prepared, { width: 600, height: 400 }, () => "copy");
    expect(result.plan.artifacts[0]).toMatchObject({ ...before.artifacts[0], revision: 8,
      [kind === "modelCard" ? "samples" : kind === "clothing" ? "mainGallery" : "gallery"]: {
        id: gallery.id, images: [expect.objectContaining({ id: "copy", file: prepared.file })],
      },
    });
    expect(result.plan.document).toEqual(before.document);
    expect(result.plan.imageGroups).toEqual(before.imageGroups);
  });

  it("resolves nested document anchors to their containing top-level row", () => {
    const before = plan();
    before.document.blocks[0].children = [{ id: "nested", type: "paragraph", props: {}, content: [], children: [] }];
    const result = insertPastedImage(before, { kind: "document", afterBlockId: "nested" },
      { ...prepared, file: "media/new.png" }, { width: 1, height: 1 }, () => "copy");
    expect(result.plan.document.blocks.map(block => block.id)).toEqual(["first", "copy", "group-block"]);
    expect(result.plan.document.blocks[0]).toEqual(before.document.blocks[0]);
  });

  it.each(["committed", "prepared", "missing"] as const)("resolves uncertain commit as %s without duplicate allocation", async (status) => {
    const repository: ImagePasteRepository = {
      prepareImagePaste: vi.fn(async () => prepared),
      commitImagePaste: vi.fn(async () => { throw new Error("lost reply"); }),
      getImagePasteStatus: vi.fn(async () => status),
      abortImagePaste: vi.fn(async () => undefined),
    };
    const publish = vi.fn();
    const operation = pasteProjectImage({
      repository, projectPath: "project", operationId: "operation", expectedPlan: plan(),
      target: { kind: "gallery", groupId: "gallery", afterImageId: null },
      image, dimensions: { width: 1, height: 1 }, makeId: () => "copy",
      isCurrent: () => true, publish,
    });
    if (status === "committed") {
      await operation;
      expect(publish).toHaveBeenCalledOnce();
      expect(repository.abortImagePaste).not.toHaveBeenCalled();
    } else {
      await expect(operation).rejects.toThrow();
      expect(publish).not.toHaveBeenCalled();
      expect(repository.abortImagePaste).toHaveBeenCalledTimes(status === "prepared" ? 1 : 0);
    }
    expect(repository.prepareImagePaste).toHaveBeenCalledOnce();
  });

  it("aborts staged files when the target retires while preparing", async () => {
    let current = true;
    const repository: ImagePasteRepository = {
      prepareImagePaste: vi.fn(async () => { current = false; return prepared; }),
      commitImagePaste: vi.fn(), getImagePasteStatus: vi.fn(),
      abortImagePaste: vi.fn(async () => undefined),
    };
    const publish = vi.fn();
    await expect(pasteProjectImage({
      repository, projectPath: "project", operationId: "operation", expectedPlan: plan(),
      target: { kind: "gallery", groupId: "gallery", afterImageId: null },
      image, dimensions: { width: 1, height: 1 }, makeId: () => "copy",
      isCurrent: () => current, publish,
    })).rejects.toThrow();
    expect(repository.commitImagePaste).not.toHaveBeenCalled();
    expect(repository.abortImagePaste).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});
