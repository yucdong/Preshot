// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { DragOverlayPreview } from "./DragOverlayPreview";

const component: PlanComponent = {
  id: "reference",
  name: "Reference",
  type: "reference",
  x: 0,
  width: 320,
  height: 240,
  description: "",
  images: [{
    id: "image",
    file: "image.png",
    caption: "legacy caption",
    aspectRatio: 1,
    frameWidth: 100,
    frameHeight: 100,
  }],
};

describe("DragOverlayPreview", () => {
  it("does not surface legacy captions in a v7 image preview", () => {
    render(
      <DragOverlayPreview
        activeId="image"
        component={component}
        imageSrc={() => undefined}
      />,
    );

    expect(screen.getByTestId("drag-overlay-preview")).toBeInTheDocument();
    expect(screen.queryByText("legacy caption")).not.toBeInTheDocument();
  });
});
