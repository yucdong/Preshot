import { describe, expect, it } from "vitest";
import type { PlanComponent, ReferenceComponent } from "../../../domain/plan/canvas/models";
import { moveImage } from "../../../domain/plan/canvas/plan";
import {
  IMAGE_GROUP_PREFIX,
  imageDropTarget,
  imageGroupDroppableId,
  imageInsertAfterFromRects,
  type ImageDragRects,
} from "./imageDropTarget";

function createReferenceComponent(id: string, imageIds: string[]): ReferenceComponent {
  return {
    id,
    type: "reference",
    title: `Reference ${id}`,
    description: "",
    width: 1,
    showCaptions: false, imageHeight: 180, images: imageIds.map((imageId) => ({ id: imageId, file: `${imageId}.jpg`, aspectRatio: 1 })),
  };
}

function createPlanComponent(id: string): PlanComponent {
  return {
    id,
    type: "plan",
    html: "",
    width: 1,
  };
}

describe("imageGroupDroppableId", () => {
  it("prefixes component id with IMAGE_GROUP_PREFIX", () => {
    expect(imageGroupDroppableId("comp-1")).toBe(`${IMAGE_GROUP_PREFIX}comp-1`);
    expect(imageGroupDroppableId("ref-abc")).toBe(`${IMAGE_GROUP_PREFIX}ref-abc`);
  });
});

describe("imageDropTarget", () => {
  describe("null return cases", () => {
    it("returns null when overId is null", () => {
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1", "img-2"])];
      const result = imageDropTarget(components, "img-1", null, false);
      expect(result).toBeNull();
    });

    it("returns null when overId equals activeImageId", () => {
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1", "img-2"])];
      const result = imageDropTarget(components, "img-1", "img-1", false);
      expect(result).toBeNull();
    });

    it("returns null when active image is not found in any reference component", () => {
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1", "img-2"])];
      const result = imageDropTarget(components, "img-nonexistent", "img-1", false);
      expect(result).toBeNull();
    });

    it("returns null when over id is not found anywhere", () => {
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1", "img-2"])];
      const result = imageDropTarget(components, "img-1", "img-nonexistent", false);
      expect(result).toBeNull();
    });

    it("returns null when overId is a group droppable id for a non-existent component", () => {
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1"])];
      const result = imageDropTarget(components, "img-1", imageGroupDroppableId("nonexistent"), false);
      expect(result).toBeNull();
    });

    it("returns null when overId is a group droppable id for a plan component", () => {
      const components: PlanComponent[] = [
        createPlanComponent("plan-1"),
        createReferenceComponent("ref-1", ["img-1"]),
      ];
      const result = imageDropTarget(components, "img-1", imageGroupDroppableId("plan-1"), false);
      expect(result).toBeNull();
    });

    it("returns null when overId is an image in a plan component (should not happen but graceful)", () => {
      const components: PlanComponent[] = [
        createPlanComponent("plan-1"),
        createReferenceComponent("ref-1", ["img-1"]),
      ];
      // Even though plan-1 has no images, test that we don't crash if we look for a non-existent image
      const result = imageDropTarget(components, "img-1", "some-other-id", false);
      expect(result).toBeNull();
    });
  });

  describe("same-component reorder", () => {
    it("handles active before over (arrayMove behavior)", () => {
      // Component: [img-1, img-2, img-3, img-4]
      // Move img-1 over img-3 → should produce [img-2, img-3, img-1, img-4]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1", "img-2", "img-3", "img-4"]),
      ];
      const result = imageDropTarget(components, "img-1", "img-3", false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-1",
        toIndex: 2, // img-3's index in the WITH-active array
      });

      // Verify by feeding through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const resultImages = (moved.components[0] as ReferenceComponent).images.map((img) => img.id);
      expect(resultImages).toEqual(["img-2", "img-3", "img-1", "img-4"]);
    });

    it("handles active after over (arrayMove behavior)", () => {
      // Component: [img-1, img-2, img-3, img-4]
      // Move img-3 over img-1 → should produce [img-3, img-1, img-2, img-4]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1", "img-2", "img-3", "img-4"]),
      ];
      const result = imageDropTarget(components, "img-3", "img-1", false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-1",
        toIndex: 0, // img-1's index in the WITH-active array
      });

      // Verify by feeding through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-3" });
      const resultImages = (moved.components[0] as ReferenceComponent).images.map((img) => img.id);
      expect(resultImages).toEqual(["img-3", "img-1", "img-2", "img-4"]);
    });

    it("handles adjacent images (no-op when moving to same position)", () => {
      // Component: [img-1, img-2, img-3]
      // Move img-1 over img-2 → toIndex should be 1 (img-2's index)
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1", "img-2", "img-3"])];
      const result = imageDropTarget(components, "img-1", "img-2", false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-1",
        toIndex: 1,
      });

      // Verify the order is [img-2, img-1, img-3]
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const resultImages = (moved.components[0] as ReferenceComponent).images.map((img) => img.id);
      expect(resultImages).toEqual(["img-2", "img-1", "img-3"]);
    });
  });

  describe("cross-component reorder", () => {
    it("inserts at front when insertAfter is false over first image", () => {
      // ref-1: [img-1, img-2]  ref-2: [img-3, img-4]
      // Move img-1 over img-3 with insertAfter=false → [img-1, img-3, img-4]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1", "img-2"]),
        createReferenceComponent("ref-2", ["img-3", "img-4"]),
      ];
      const result = imageDropTarget(components, "img-1", "img-3", false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 0, // img-3's position (0) + 0
      });

      // Verify through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref2Images = (moved.components[1] as ReferenceComponent).images.map((img) => img.id);
      expect(ref2Images).toEqual(["img-1", "img-3", "img-4"]);
    });

    it("inserts in middle with insertAfter true", () => {
      // ref-1: [img-1, img-2]  ref-2: [img-3, img-4]
      // Move img-1 over img-3 with insertAfter=true → [img-3, img-1, img-4]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1", "img-2"]),
        createReferenceComponent("ref-2", ["img-3", "img-4"]),
      ];
      const result = imageDropTarget(components, "img-1", "img-3", true);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 1, // img-3's position (0) + 1
      });

      // Verify through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref2Images = (moved.components[1] as ReferenceComponent).images.map((img) => img.id);
      expect(ref2Images).toEqual(["img-3", "img-1", "img-4"]);
    });

    it("inserts at end with insertAfter true over last image", () => {
      // ref-1: [img-1, img-2]  ref-2: [img-3, img-4]
      // Move img-1 over img-4 with insertAfter=true → [img-3, img-4, img-1]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1", "img-2"]),
        createReferenceComponent("ref-2", ["img-3", "img-4"]),
      ];
      const result = imageDropTarget(components, "img-1", "img-4", true);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 2, // img-4's position (1) + 1
      });

      // Verify through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref2Images = (moved.components[1] as ReferenceComponent).images.map((img) => img.id);
      expect(ref2Images).toEqual(["img-3", "img-4", "img-1"]);
    });

    it("inserts with insertAfter false in middle", () => {
      // ref-1: [img-1]  ref-2: [img-2, img-3, img-4]
      // Move img-1 over img-3 with insertAfter=false → [img-2, img-1, img-3, img-4]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1"]),
        createReferenceComponent("ref-2", ["img-2", "img-3", "img-4"]),
      ];
      const result = imageDropTarget(components, "img-1", "img-3", false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 1, // img-3's position (1) + 0
      });

      // Verify through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref2Images = (moved.components[1] as ReferenceComponent).images.map((img) => img.id);
      expect(ref2Images).toEqual(["img-2", "img-1", "img-3", "img-4"]);
    });
  });

  describe("drop onto group droppable", () => {
    it("appends to empty component via group droppable", () => {
      // ref-1: [img-1]  ref-2: []
      // Move img-1 to ref-2's group → [img-1]
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1"]),
        createReferenceComponent("ref-2", []),
      ];
      const result = imageDropTarget(components, "img-1", imageGroupDroppableId("ref-2"), false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 0, // empty array without active = length 0
      });

      // Verify through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref2Images = (moved.components[1] as ReferenceComponent).images.map((img) => img.id);
      expect(ref2Images).toEqual(["img-1"]);
    });

    it("appends to non-empty component via group droppable (same component)", () => {
      // ref-1: [img-1, img-2, img-3]
      // Drop img-1 onto ref-1's group → append to end after removing active
      const components: PlanComponent[] = [createReferenceComponent("ref-1", ["img-1", "img-2", "img-3"])];
      const result = imageDropTarget(components, "img-1", imageGroupDroppableId("ref-1"), false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-1",
        toIndex: 2, // [img-2, img-3].length = 2
      });

      // Verify through moveImage - should move to end
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref1Images = (moved.components[0] as ReferenceComponent).images.map((img) => img.id);
      expect(ref1Images).toEqual(["img-2", "img-3", "img-1"]);
    });

    it("appends to non-empty component via group droppable (different component)", () => {
      // ref-1: [img-1]  ref-2: [img-2, img-3]
      // Move img-1 to ref-2's group → append at end
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1"]),
        createReferenceComponent("ref-2", ["img-2", "img-3"]),
      ];
      const result = imageDropTarget(components, "img-1", imageGroupDroppableId("ref-2"), false);

      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 2, // [img-2, img-3].length = 2 (active not in target)
      });

      // Verify through moveImage
      const plan = { schemaVersion: 4 as const, components };
      const moved = moveImage(plan, { ...result!, imageId: "img-1" });
      const ref2Images = (moved.components[1] as ReferenceComponent).images.map((img) => img.id);
      expect(ref2Images).toEqual(["img-2", "img-3", "img-1"]);
    });
  });

  describe("ignores plan components", () => {
    it("skips plan components when looking for active image", () => {
      const components: PlanComponent[] = [
        createPlanComponent("plan-1"),
        createReferenceComponent("ref-1", ["img-1", "img-2"]),
      ];
      // Active img-1 should be found in ref-1, not in plan-1
      const result = imageDropTarget(components, "img-1", "img-2", false);
      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-1",
        toIndex: 1,
      });
    });

    it("skips plan components when looking for over image", () => {
      const components: PlanComponent[] = [
        createReferenceComponent("ref-1", ["img-1"]),
        createPlanComponent("plan-1"),
        createReferenceComponent("ref-2", ["img-2"]),
      ];
      // Over img-2 should be found in ref-2, plan-1 should be ignored
      const result = imageDropTarget(components, "img-1", "img-2", false);
      expect(result).toEqual({
        fromComponentId: "ref-1",
        toComponentId: "ref-2",
        toIndex: 0,
      });
    });
  });
});

describe("imageInsertAfterFromRects", () => {
  it("returns true when active center-x is right of over center-x", () => {
    const active: ImageDragRects["activeTranslated"] = { left: 200, width: 100 }; // center at 250
    const over: ImageDragRects["over"] = { left: 0, width: 100 }; // center at 50
    expect(imageInsertAfterFromRects(active, over)).toBe(true);
  });

  it("returns false when active center-x is left of over center-x", () => {
    const active: ImageDragRects["activeTranslated"] = { left: 0, width: 100 }; // center at 50
    const over: ImageDragRects["over"] = { left: 200, width: 100 }; // center at 250
    expect(imageInsertAfterFromRects(active, over)).toBe(false);
  });

  it("returns false when active center-x equals over center-x", () => {
    const active: ImageDragRects["activeTranslated"] = { left: 100, width: 100 }; // center at 150
    const over: ImageDragRects["over"] = { left: 100, width: 100 }; // center at 150
    expect(imageInsertAfterFromRects(active, over)).toBe(false);
  });

  it("returns false when active rect is null", () => {
    const over: ImageDragRects["over"] = { left: 100, width: 100 };
    expect(imageInsertAfterFromRects(null, over)).toBe(false);
  });

  it("returns false when over rect is null", () => {
    const active: ImageDragRects["activeTranslated"] = { left: 100, width: 100 };
    expect(imageInsertAfterFromRects(active, null)).toBe(false);
  });

  it("returns false when both rects are null", () => {
    expect(imageInsertAfterFromRects(null, null)).toBe(false);
  });

  it("handles different widths correctly", () => {
    const active: ImageDragRects["activeTranslated"] = { left: 100, width: 50 }; // center at 125
    const over: ImageDragRects["over"] = { left: 50, width: 100 }; // center at 100
    expect(imageInsertAfterFromRects(active, over)).toBe(true);
  });
});
