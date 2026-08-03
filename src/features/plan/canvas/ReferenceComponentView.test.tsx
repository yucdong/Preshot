import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import { ReferenceComponentView } from "./ReferenceComponentView";

vi.mock("../RichTextEditor", () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
}));

vi.mock("../GroupImageGrid", () => ({
  GroupImageGrid: () => <div data-testid="group-image-grid" />,
}));

const mockComponent: ReferenceComponent = {
  id: "ref-1",
  type: "reference",
  widthFraction: "1",
  height: 320,
  title: "Test Reference",
  description: "",
  columnsPerRow: 3,
  showCaptions: false,
  images: [],
};

describe("ReferenceComponentView", () => {
  it("renders a caption toggle checkbox with correct accessible name", () => {
    const onToggleCaptions = vi.fn();

    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onSetColumns={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onToggleCaptions={onToggleCaptions}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("reflects showCaptions state in the checkbox", () => {
    const onToggleCaptions = vi.fn();

    render(
      <ReferenceComponentView
        component={{ ...mockComponent, showCaptions: true }}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onSetColumns={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onToggleCaptions={onToggleCaptions}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    expect(checkbox).toBeChecked();
  });

  it("calls onToggleCaptions with component id when toggled", async () => {
    const onToggleCaptions = vi.fn();
    const user = userEvent.setup();

    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onSetColumns={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onToggleCaptions={onToggleCaptions}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    await user.click(checkbox);

    expect(onToggleCaptions).toHaveBeenCalledWith("ref-1");
    expect(onToggleCaptions).toHaveBeenCalledTimes(1);
  });
});
