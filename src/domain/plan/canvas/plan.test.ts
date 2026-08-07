import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  addComponent,
  addReferenceImage,
  moveComponent,
  moveImage,
  moveImages,
  removeComponent,
  resizeComponent,
  setImageAspectRatio,
  setImageCaption,
  setImageFrame,
  updatePlanHtml,
} from "./plan";
import type {
  PlanComponent,
  ProjectPlan,
  ReferenceComponent,
} from "./models";

const canvasWidth = contentSize(DEFAULT_PAGE_GEOMETRY).width;

function planText(
  id: string,
  rect = { x: 0, y: 60, width: canvasWidth, height: 220 },
): PlanComponent {
  return { id, name: `文案${id}`, type: "plan", ...rect, html: `<p>${id}</p>` };
}

function reference(
  id: string,
  images: string[] = [],
  rect = { x: 0, y: 60, width: canvasWidth, height: 320 },
): ReferenceComponent {
  return {
    id,
    name: id,
    type: "reference",
    ...rect,
    description: "",
    images: images.map((imageId) => ({
      id: imageId,
      file: `references/${imageId}.png`,
      aspectRatio: 1,
      frameWidth: 120,
      frameHeight: 120,
    })),
  };
}

function withComponents(components: PlanComponent[]): ProjectPlan {
  return { schemaVersion: 7, title: "Demo", components };
}

describe("v7 canvas reducers", () => {
  it("inserts every new card below the lowest existing card without changing stable order", () => {
    const plan = withComponents([
      planText("a", { x: 120, y: 100, width: 180, height: 80 }),
      planText("b", { x: 0, y: 240, width: 180, height: 140 }),
    ]);

    const next = addComponent(plan, planText("c"));

    expect(next.components.map((component) => component.id)).toEqual(["a", "b", "c"]);
    expect(next.components[2]).toMatchObject({
      x: 0,
      y: 404,
      width: canvasWidth,
      height: 220,
    });
  });

  it("moves direct card coordinates while clamping within the fixed canvas", () => {
    const plan = withComponents([planText("a", { x: 0, y: 60, width: 240, height: 100 })]);

    const next = moveComponent(plan, { id: "a", x: canvasWidth, y: -5 });

    expect(next.components[0]).toMatchObject({
      x: canvasWidth - 240,
      y: 0,
      width: 240,
      height: 100,
    });
    expect(next.components.map((component) => component.id)).toEqual(["a"]);
  });

  it("resizes width and height independently and persists the full card rectangle", () => {
    const plan = withComponents([planText("a", { x: 300, y: 80, width: 200, height: 100 })]);

    const next = resizeComponent(plan, {
      id: "a",
      x: 500,
      y: 120,
      width: 120,
      height: 80,
    });

    expect(next.components[0]).toMatchObject({
      x: canvasWidth - 120,
      y: 120,
      width: 120,
      height: 80,
    });
  });

  it("updates plan html and leaves unrelated cards unchanged", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    const next = updatePlanHtml(plan, { id: "a", html: "<p>updated</p>" });
    expect(next.components[0]).toMatchObject({ html: "<p>updated</p>" });
    expect(next.components[1]).toBe(plan.components[1]);
  });

  it("keeps image DnD and non-rendered legacy captions working on v7 frames", () => {
    const plan = withComponents([reference("r1", ["i1", "i2"]), reference("r2", [])]);
    const moved = moveImage(plan, {
      fromComponentId: "r1",
      imageId: "i1",
      toComponentId: "r2",
      toIndex: 0,
    });
    const withCaption = setImageCaption(moved, {
      componentId: "r2",
      imageId: "i1",
      caption: "retained only",
    });
    const resized = setImageFrame(withCaption, {
      componentId: "r2",
      imageId: "i1",
      frameWidth: 200,
      frameHeight: 90,
    });

    expect((resized.components[0] as ReferenceComponent).images.map((image) => image.id)).toEqual(["i2"]);
    expect((resized.components[1] as ReferenceComponent).images[0]).toMatchObject({
      id: "i1",
      caption: "retained only",
      frameWidth: 200,
      frameHeight: 90,
    });
  });

  it("moves selected images in canvas order and updates source image metadata", () => {
    const plan = withComponents([
      reference("r1", ["i1", "i2"]),
      reference("r2", ["i3"]),
    ]);
    const moved = moveImages(plan, {
      imageIds: ["i3", "i1"],
      toComponentId: "r1",
      toIndex: 1,
    });
    const withImage = addReferenceImage(moved, {
      componentId: "r2",
      image: {
        id: "i4",
        file: "references/i4.png",
        aspectRatio: 1.5,
        frameWidth: 180,
        frameHeight: 120,
      },
    });
    const ratio = setImageAspectRatio(withImage, {
      componentId: "r2",
      imageId: "i4",
      aspectRatio: 2,
    });

    expect((ratio.components[0] as ReferenceComponent).images.map((image) => image.id)).toEqual([
      "i2",
      "i1",
      "i3",
    ]);
    expect((ratio.components[1] as ReferenceComponent).images[0]).toMatchObject({
      id: "i4",
      aspectRatio: 2,
      frameWidth: 180,
      frameHeight: 120,
    });
  });

  it("removes known cards and returns the original plan for unknown ids", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    expect(removeComponent(plan, "a").components.map((component) => component.id)).toEqual(["b"]);
    expect(removeComponent(plan, "missing")).toBe(plan);
  });
});
