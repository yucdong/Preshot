import { describe, expect, it } from "vitest";
import {
  addComponent,
  addReferenceImage,
  addReferenceImages,
  moveComponent,
  moveImage,
  removeComponent,
  resizeComponent,
  setImageCaption,
  setImageAspectRatio,
  setImageHeight,
  toggleReferenceCaptions,
  updatePlanHtml,
} from "./plan";
import {
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
} from "./models";

function planText(id: string): PlanComponent {
  return { id, type: "plan", width: 1, html: `<p>${id}</p>` };
}
function reference(id: string, images: string[] = []): ReferenceComponent {
  return {
    id,
    type: "reference",
    width: 1,
    title: id,
    description: "",
    showCaptions: false,
    imageHeight: 180,
    images: images.map((imageId) => ({ id: imageId, file: `references/${imageId}.png`, aspectRatio: 1 })),
  };
}
function withComponents(components: PlanComponent[]): ProjectPlan {
  return { schemaVersion: 4, components };
}

describe("canvas reducers", () => {
  it("prepends a component (inserts at index 0)", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    const next = addComponent(plan, planText("c"));
    expect(next.components).toHaveLength(3);
    expect(next.components[0].id).toBe("c");
    expect(next.components[1].id).toBe("a");
    expect(next.components[2].id).toBe("b");
  });

  it("removes a component by id and no-ops on unknown id", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    expect(removeComponent(plan, "a").components.map((c) => c.id)).toEqual(["b"]);
    expect(removeComponent(plan, "zz")).toBe(plan);
  });

  it("reorders a component to a new index (post-removal index)", () => {
    const plan = withComponents([planText("a"), planText("b"), planText("c")]);
    // remove a -> [b,c]; insert a at index 2 -> [b,c,a]
    expect(moveComponent(plan, { id: "a", toIndex: 2 }).components.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("no-ops moveComponent when the position is unchanged", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    expect(moveComponent(plan, { id: "a", toIndex: 0 })).toBe(plan);
  });

  it("resizes to a continuous width, clamped to MIN_WIDTH", () => {
    const plan = withComponents([planText("a")]);
    const resized = resizeComponent(plan, { id: "a", width: 0.5 });
    expect(resized.components[0].width).toBe(0.5);
    const MIN_WIDTH = 0.15;
    const clamped = resizeComponent(plan, { id: "a", width: 0.01 });
    expect(clamped.components[0].width).toBe(MIN_WIDTH);
  });

  it("resizes width without introducing a persisted height", () => {
    const plan = withComponents([{ id: "p", type: "plan", width: 1, html: "" }]);
    const next = resizeComponent(plan, {
      id: "p",
      width: 0.5,
    });

    expect(next.components[0]).toEqual({ id: "p", type: "plan", width: 0.5, html: "" });
    expect(next.components[0]).not.toHaveProperty("height");
  });

  it("updates plan html", () => {
    const plan = withComponents([planText("a")]);
    expect((updatePlanHtml(plan, { id: "a", html: "<p>x</p>" }).components[0] as { html: string }).html).toBe("<p>x</p>");
  });

  it("adds and toggles captions on a reference component", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const withImage = addReferenceImage(plan, { componentId: "r", image: { id: "i2", file: "references/i2.png", aspectRatio: 1 } });
    expect((withImage.components[0] as ReferenceComponent).images).toHaveLength(2);
    expect((toggleReferenceCaptions(plan, "r").components[0] as ReferenceComponent).showCaptions).toBe(true);
  });

  it("sets a per-image caption", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const next = setImageCaption(plan, { componentId: "r", imageId: "i1", caption: "sunset" });
    expect((next.components[0] as ReferenceComponent).images[0].caption).toBe("sunset");
  });

  it("setImageCaption returns same plan reference when caption is unchanged", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const withCaption = setImageCaption(plan, { componentId: "r", imageId: "i1", caption: "sunset" });
    const reapplied = setImageCaption(withCaption, { componentId: "r", imageId: "i1", caption: "sunset" });
    expect(reapplied).toBe(withCaption);
  });

  it("setImageCaption returns same plan reference when imageId not found", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const result = setImageCaption(plan, { componentId: "r", imageId: "unknown", caption: "sunset" });
    expect(result).toBe(plan);
  });

  it("moves an image across reference components", () => {
    const plan = withComponents([reference("r1", ["i1", "i2"]), reference("r2", [])]);
    const next = moveImage(plan, { fromComponentId: "r1", imageId: "i1", toComponentId: "r2", toIndex: 0 });
    expect((next.components[0] as ReferenceComponent).images.map((i) => i.id)).toEqual(["i2"]);
    expect((next.components[1] as ReferenceComponent).images.map((i) => i.id)).toEqual(["i1"]);
  });

  it("appends multiple images in batch via addReferenceImages", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const images = [
      { id: "i2", file: "references/i2.png", aspectRatio: 1 },
      { id: "i3", file: "references/i3.png", aspectRatio: 1 },
    ];
    const next = addReferenceImages(plan, { componentId: "r", images });
    expect((next.components[0] as ReferenceComponent).images).toHaveLength(3);
    expect((next.components[0] as ReferenceComponent).images.map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("sets image aspect ratio and no-ops when unchanged", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const withRatio = setImageAspectRatio(plan, { componentId: "r", imageId: "i1", aspectRatio: 1.5 });
    expect((withRatio.components[0] as ReferenceComponent).images[0].aspectRatio).toBe(1.5);
    const reapplied = setImageAspectRatio(withRatio, { componentId: "r", imageId: "i1", aspectRatio: 1.5 });
    expect(reapplied).toBe(withRatio);
  });

  it("setImageAspectRatio returns same plan when imageId not found", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const result = setImageAspectRatio(plan, { componentId: "r", imageId: "unknown", aspectRatio: 1.5 });
    expect(result).toBe(plan);
  });

  it("sets reference component imageHeight with clamping", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const MIN = 80;
    const MAX = 400;
    // Normal value
    const withHeight = setImageHeight(plan, "r", 200);
    expect((withHeight.components[0] as ReferenceComponent).imageHeight).toBe(200);
    // Clamp below MIN
    const clamped = setImageHeight(plan, "r", 50);
    expect((clamped.components[0] as ReferenceComponent).imageHeight).toBe(MIN);
    // Clamp above MAX
    const clampedMax = setImageHeight(plan, "r", 500);
    expect((clampedMax.components[0] as ReferenceComponent).imageHeight).toBe(MAX);
  });

  it("setImageHeight returns same plan when imageHeight is unchanged", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const withHeight = setImageHeight(plan, "r", 200);
    const reapplied = setImageHeight(withHeight, "r", 200);
    expect(reapplied).toBe(withHeight);
  });
});
