import { describe, expect, it } from "vitest";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "./geometry";
import {
  addComponent,
  addReferenceImage,
  defaultImageFrame,
  moveComponent,
  moveImage,
  moveImages,
  reorderComponent,
  resetImageFrame,
  removeComponent,
  resizeComponent,
  scaleReferenceImages,
  setImageAspectRatio,
  setImageAspectRatioForFile,
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
  rect = { x: 0, width: canvasWidth, height: 220 },
): PlanComponent {
  return { id, name: `文案${id}`, type: "plan", ...rect, html: `<p>${id}</p>` };
}

function reference(
  id: string,
  images: string[] = [],
  rect = { x: 0, width: canvasWidth, height: 320 },
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
  return { schemaVersion: 8, title: "Demo", components };
}

describe("v7 canvas reducers", () => {
  it("inserts every new component at the top of document order", () => {
    const plan = withComponents([
      planText("a", { x: 120, width: 180, height: 80 }),
      planText("b", { x: 0, width: 180, height: 140 }),
    ]);

    const next = addComponent(plan, planText("c"));

    expect(next.components.map((component) => component.id)).toEqual(["c", "a", "b"]);
    expect(next.components[0]).toMatchObject({
      x: 0,
      width: canvasWidth,
      height: 220,
    });
  });

  it("moves a card horizontally while vertical position remains derived from order", () => {
    const plan = withComponents([planText("a", { x: 0, width: 240, height: 100 })]);

    const next = moveComponent(plan, { id: "a", x: canvasWidth, y: -5 });

    expect(next.components[0]).toMatchObject({
      x: canvasWidth - 240,
      width: 240,
      height: 100,
    });
    expect(next.components[0]).not.toHaveProperty("y");
    expect(next.components.map((component) => component.id)).toEqual(["a"]);
  });

  it("reorders one component by insertion index without changing component geometry", () => {
    const plan = withComponents([planText("a"), planText("b"), planText("c")]);

    const next = reorderComponent(plan, { id: "a", toIndex: 2 });

    expect(next.components.map((component) => component.id)).toEqual(["b", "c", "a"]);
    expect(next.components[2]).toBe(plan.components[0]);
    expect(reorderComponent(next, { id: "missing", toIndex: 0 })).toBe(next);
  });

  it("resizes width and height independently and persists the full card rectangle", () => {
    const plan = withComponents([planText("a", { x: 300, width: 200, height: 100 })]);

    const next = resizeComponent(plan, {
      id: "a",
      x: 500,
      width: 120,
      height: 80,
    });

    expect(next.components[0]).toMatchObject({
      x: canvasWidth - 120,
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

  it("resets an arbitrarily resized image frame to its aspect-based default", () => {
    const plan = withComponents([reference("r1", ["i1"])]);
    const resized = setImageFrame(plan, {
      componentId: "r1",
      imageId: "i1",
      frameWidth: 73,
      frameHeight: 241,
    });

    const withRatio = setImageAspectRatio(resized, {
      componentId: "r1",
      imageId: "i1",
      aspectRatio: 2,
    });
    const reset = resetImageFrame(withRatio, {
      componentId: "r1",
      imageId: "i1",
    });

    expect(defaultImageFrame(2)).toEqual({ frameWidth: 270, frameHeight: 135 });
    expect((reset.components[0] as ReferenceComponent).images[0]).toMatchObject({
      frameWidth: 270,
      frameHeight: 135,
      aspectRatio: 2,
    });
  });

  it("scales every image frame in a reference group by the same factor", () => {
    const original = withComponents([{
      ...reference("r1", ["i1", "i2"]),
      images: [
        {
          id: "i1",
          file: "references/i1.png",
          aspectRatio: 2,
          frameWidth: 200,
          frameHeight: 100,
        },
        {
          id: "i2",
          file: "references/i2.png",
          aspectRatio: 0.5,
          frameWidth: 60,
          frameHeight: 120,
        },
      ],
    }]);

    const scaled = scaleReferenceImages(original, { componentId: "r1", scale: 0.75 });
    const images = (scaled.components[0] as ReferenceComponent).images;

    expect(images).toMatchObject([
      { frameWidth: 150, frameHeight: 75 },
      { frameWidth: 45, frameHeight: 90 },
    ]);
    expect(images.map((image) => image.frameWidth / image.frameHeight)).toEqual([2, 0.5]);
    expect(scaleReferenceImages(scaled, { componentId: "r1", scale: 1 })).toBe(scaled);
    expect(scaleReferenceImages(scaled, { componentId: "r1", scale: 0 })).toBe(scaled);
  });

  it("updates an untouched default frame when an imported image's ratio is measured", () => {
    const plan = withComponents([{
      ...reference("r1", []),
      images: [
        {
          id: "default",
          file: "references/default.png",
          aspectRatio: 1,
          frameWidth: 135,
          frameHeight: 135,
        },
        {
          id: "custom",
          file: "references/custom.png",
          aspectRatio: 1,
          frameWidth: 180,
          frameHeight: 90,
        },
      ],
    }]);

    const next = setImageAspectRatioForFile(plan, {
      file: "references/default.png",
      aspectRatio: 2,
    });

    expect((next.components[0] as ReferenceComponent).images).toEqual([
      expect.objectContaining({
        id: "default",
        aspectRatio: 2,
        frameWidth: 270,
        frameHeight: 135,
      }),
      expect.objectContaining({
        id: "custom",
        frameWidth: 180,
        frameHeight: 90,
      }),
    ]);
  });

  it("removes known cards and returns the original plan for unknown ids", () => {
    const plan = withComponents([planText("a"), planText("b")]);
    expect(removeComponent(plan, "a").components.map((component) => component.id)).toEqual(["b"]);
    expect(removeComponent(plan, "missing")).toBe(plan);
  });
});
