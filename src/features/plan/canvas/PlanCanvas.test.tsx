import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanComponent } from "../../../domain/plan/canvas/models";
import { PlanCanvas } from "./PlanCanvas";

const planComponent: PlanComponent = {
  id: "plan1",
  type: "plan",
  widthFraction: "1",
  height: 220,
  html: "<p>拍摄清单</p>",
};

const referenceComponent: PlanComponent = {
  id: "ref1",
  type: "reference",
  widthFraction: "1",
  height: 320,
  title: "Lookbook",
  description: "",
  columnsPerRow: 3,
  showCaptions: false,
  images: [
    { id: "i1", file: "references/0001.png" },
    { id: "i2", file: "references/0002.png" },
  ],
};

function renderCanvas(overrides: Partial<Parameters<typeof PlanCanvas>[0]> = {}) {
  const props = {
    components: [planComponent, referenceComponent],
    scale: 1,
    imageSrc: (file: string) => (file.startsWith("references/") ? "data:image/png;base64,AA" : undefined),
    onRemoveComponent: vi.fn(),
    onChangeHtml: vi.fn(),
    onSetTitle: vi.fn(),
    onSetDescription: vi.fn(),
    onSetColumns: vi.fn(),
    onAddImage: vi.fn(),
    onRemoveImage: vi.fn(),
    onOpenImage: vi.fn(),
    ...overrides,
  };
  render(
    <DndContext>
      <PlanCanvas {...props} />
    </DndContext>,
  );
  return props;
}

describe("PlanCanvas", () => {
  it("renders one A4 page with both plan and reference components", () => {
    renderCanvas();
    const pages = screen.getAllByTestId("canvas-page");
    expect(pages).toHaveLength(1);
  });

  it("plan component shows its editor", async () => {
    renderCanvas();
    const editor = screen.getByRole("group", { name: "摄影计划" });
    expect(editor).toBeInTheDocument();
    expect(await screen.findByText("拍摄清单")).toBeVisible();
  });

  it("reference component shows title and image tiles", () => {
    renderCanvas();
    const openButton = screen.getByRole("button", { name: "打开参考图 1" });
    expect(openButton).toBeVisible();
  });

  it("delete button calls onRemoveComponent with the component id", () => {
    const props = renderCanvas();
    const deleteButtons = screen.getAllByRole("button", { name: "移除组件" });
    fireEvent.click(deleteButtons[0]);
    expect(props.onRemoveComponent).toHaveBeenCalledWith("plan1");
  });
});
