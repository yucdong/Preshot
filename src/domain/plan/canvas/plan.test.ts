import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  addComponent,
  addReferenceImage,
  moveComponent,
  moveImage,
  removeComponent,
  resizeComponent,
  setImageCaption,
  toggleReferenceCaptions,
  updatePlanHtml,
} from "./plan";
import {
  EMPTY_PLAN,
  MIN_COMPONENT_HEIGHT,
  type PlanComponent,
  type ProjectPlan,
  type ReferenceComponent,
} from "./models";

const maxHeight = contentSize(DEFAULT_PAGE_GEOMETRY).height;

function planText(id: string): PlanComponent {
  return { id, type: "plan", widthFraction: "1", height: 200, html: `<p>${id}</p>` };
}
function reference(id: string, images: string[] = []): ReferenceComponent {
  return {
    id,
    type: "reference",
    widthFraction: "1",
    height: 300,
    title: id,
    description: "",
    columnsPerRow: 3,
    showCaptions: false,
    images: images.map((imageId) => ({ id: imageId, file: `references/${imageId}.png` })),
  };
}
function withComponents(components: PlanComponent[]): ProjectPlan {
  return { schemaVersion: 2, components };
}

describe("canvas reducers", () => {
  it("appends a component", () => {
    expect(addComponent(EMPTY_PLAN, planText("a")).components).toHaveLength(1);
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

  it("snaps width and clamps height on resize", () => {
    const plan = withComponents([planText("a")]);
    const resized = resizeComponent(plan, { id: "a", widthFraction: "1/2", height: 10 });
    expect(resized.components[0].widthFraction).toBe("1/2");
    expect(resized.components[0].height).toBe(MIN_COMPONENT_HEIGHT);
    expect(resizeComponent(plan, { id: "a", height: maxHeight + 999 }).components[0].height).toBeCloseTo(maxHeight, 5);
  });

  it("updates plan html", () => {
    const plan = withComponents([planText("a")]);
    expect((updatePlanHtml(plan, { id: "a", html: "<p>x</p>" }).components[0] as { html: string }).html).toBe("<p>x</p>");
  });

  it("adds and toggles captions on a reference component", () => {
    const plan = withComponents([reference("r", ["i1"])]);
    const withImage = addReferenceImage(plan, { componentId: "r", image: { id: "i2", file: "references/i2.png" } });
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
});
