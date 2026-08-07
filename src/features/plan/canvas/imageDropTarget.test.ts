import { describe, expect, it } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { imageGroupDroppableId, selectedImageDropTarget } from "./imageDropTarget";

function reference(id: string, imageIds: string[]): PlanComponent {
  return {
    id,
    name: id,
    type: "reference",
    x: 0,
    y: 60,
    width: 320,
    height: 240,
    description: "",
    images: imageIds.map((imageId) => ({
      id: imageId,
      file: `${imageId}.png`,
      aspectRatio: 1,
      frameWidth: 100,
      frameHeight: 100,
    })),
  };
}

describe("selectedImageDropTarget", () => {
  it("targets another reference group's direct image order", () => {
    const components = [reference("a", ["a1", "a2"]), reference("b", ["b1"])];
    expect(
      selectedImageDropTarget(
        components,
        "a1",
        new Set(["a1"]),
        imageGroupDroppableId("b"),
        false,
      ),
    ).toEqual({
      imageIds: ["a1"],
      toComponentId: "b",
      toIndex: 1,
    });
  });

  it("rejects unknown image targets", () => {
    expect(
      selectedImageDropTarget(
        [reference("a", ["a1"])],
        "a1",
        new Set(["a1"]),
        "missing",
        false,
      ),
    ).toBeNull();
  });
});
