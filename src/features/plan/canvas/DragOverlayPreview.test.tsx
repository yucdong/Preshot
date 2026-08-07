import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { DragOverlayPreview } from "./DragOverlayPreview";

describe("DragOverlayPreview", () => {
  it("renders a compact component summary without mounting the editor", () => {
    const component: PlanComponent = {
      id: "plan-1",
      name: "文案1",
      type: "plan",
      width: 1,
      contentScale: 1,
      html: "<p>第一段</p><p>第二段</p>",
    };

    render(<DragOverlayPreview active={{ type: "component", id: "plan-1" }} component={component} imageSrc={() => undefined} />);

    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("文案");
    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("6 个字");
    expect(screen.queryByRole("group", { name: "摄影计划" })).toBeNull();
  });

  it("counts visible plan text instead of raw html entities", () => {
    const component: PlanComponent = {
      id: "plan-2",
      name: "文案1",
      type: "plan",
      width: 1,
      contentScale: 1,
      html: "<p>A&nbsp;B &amp; C</p>",
    };

    render(<DragOverlayPreview active={{ type: "component", id: "plan-2" }} component={component} imageSrc={() => undefined} />);

    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("A B & C");
    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("4 个字");
  });

  it("renders a reference component count summary instead of a bare number", () => {
    const component: PlanComponent = {
      id: "ref-1",
      type: "reference",
      width: 1,
      contentScale: 1,
      name: "Lookbook",
      description: "",
      showDescription: true,
      showCaptions: false,
      imageHeight: 135,
      images: [
        { id: "img-1", file: "references/0001.png", aspectRatio: 1.5 },
        { id: "img-2", file: "references/0002.png", aspectRatio: 1.2 },
      ],
    };

    render(<DragOverlayPreview active={{ type: "component", id: "ref-1" }} component={component} imageSrc={() => undefined} />);

    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("Lookbook");
    expect(screen.getByTestId("drag-overlay-preview")).toHaveTextContent("2 张参考图");
    expect(screen.getByTestId("drag-overlay-preview")).not.toHaveTextContent("Lookbook · 2");
  });

  it("renders the dragged image preview together with its caption", () => {
    const component: PlanComponent = {
      id: "ref-1",
      type: "reference",
      width: 1,
      contentScale: 1,
      name: "Lookbook",
      description: "",
      showDescription: true,
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
