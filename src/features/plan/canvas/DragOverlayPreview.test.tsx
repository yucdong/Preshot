import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { DragOverlayPreview } from "./DragOverlayPreview";

describe("DragOverlayPreview", () => {
  it("renders a compact component summary without mounting the editor", () => {
    const component: PlanComponent = {
      id: "plan-1",
      type: "plan",
      width: 1,
      html: "<p>第一段</p><p>第二段</p>",
    };

    render(<DragOverlayPreview active={{ type: "component", id: "plan-1" }} component={component} imageSrc={() => undefined} />);

    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("摄影计划");
    expect(screen.queryByRole("group", { name: "摄影计划" })).toBeNull();
  });

  it("renders the dragged image preview together with its caption", () => {
    const component: PlanComponent = {
      id: "ref-1",
      type: "reference",
      width: 1,
      title: "Lookbook",
      description: "",
      showCaptions: true,
      imageHeight: 135,
      images: [{ id: "img-1", file: "references/0001.png", caption: "逆光侧脸", aspectRatio: 1.5 }],
    };

    render(
      <DragOverlayPreview
        active={{ type: "image", id: "img-1" }}
        component={component}
        imageSrc={() => "data:image/png;base64,AA"}
      />,
    );

    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("逆光侧脸");
    expect(screen.getByRole("img", { name: "参考图" })).toBeVisible();
  });
});
