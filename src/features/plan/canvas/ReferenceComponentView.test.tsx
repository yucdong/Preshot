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
  width: 1,
  title: "Test Reference",
  description: "",
  showCaptions: false, imageHeight: 180, images: [],
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
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onToggleCaptions={onToggleCaptions}
        slots={[]}
        scale={1}
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
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onToggleCaptions={onToggleCaptions}
        slots={[]}
        scale={1}
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
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onToggleCaptions={onToggleCaptions}
        slots={[]}
        scale={1}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    await user.click(checkbox);

    expect(onToggleCaptions).toHaveBeenCalledWith("ref-1");
    expect(onToggleCaptions).toHaveBeenCalledTimes(1);
  });

  it("renders 添加描述 button when description is empty and no editor", () => {
    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    const button = screen.getByRole("button", { name: "添加描述" });
    expect(button).toBeInTheDocument();
    expect(screen.queryByTestId("rich-text-editor")).not.toBeInTheDocument();
  });

  it("reveals editor when 添加描述 button is clicked", async () => {
    const user = userEvent.setup();

    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    const button = screen.getByRole("button", { name: "添加描述" });
    await user.click(button);

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加描述" })).not.toBeInTheDocument();
  });

  it("renders editor when description is non-empty and no button", () => {
    render(
      <ReferenceComponentView
        component={{ ...mockComponent, description: "<p>Some description</p>" }}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加描述" })).not.toBeInTheDocument();
  });

  it("does not render columns select control", () => {
    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onSetImageHeight={vi.fn()}
        onAddImages={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    expect(screen.queryByLabelText("每行图片数:")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders image-height stepper with - and + buttons", () => {
    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onSetImageHeight={vi.fn()}
        onAddImages={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    expect(screen.getByText("图片高度")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "减小图片高度" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "增大图片高度" })).toBeInTheDocument();
  });

  it("calls onSetImageHeight when + button is clicked", async () => {
    const onSetImageHeight = vi.fn();
    const user = userEvent.setup();

    render(
      <ReferenceComponentView
        component={{ ...mockComponent, imageHeight: 180 }}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onSetImageHeight={onSetImageHeight}
        onAddImages={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    await user.click(screen.getByRole("button", { name: "增大图片高度" }));
    expect(onSetImageHeight).toHaveBeenCalledWith("ref-1", 200);
  });

  it("calls onSetImageHeight when - button is clicked", async () => {
    const onSetImageHeight = vi.fn();
    const user = userEvent.setup();

    render(
      <ReferenceComponentView
        component={{ ...mockComponent, imageHeight: 180 }}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onSetImageHeight={onSetImageHeight}
        onAddImages={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    await user.click(screen.getByRole("button", { name: "减小图片高度" }));
    expect(onSetImageHeight).toHaveBeenCalledWith("ref-1", 160);
  });

  it("uses i18n keys for stepper button aria-labels", () => {
    // TDD: Test for Finding 4 - should use translated labels
    render(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetTitle={vi.fn()}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onSetImageHeight={vi.fn()}
        onAddImages={vi.fn()}
        slots={[]}
        scale={1}
      />,
    );

    // These buttons should use i18n translated labels
    const decreaseButton = screen.getByRole("button", { name: "减小图片高度" });
    const increaseButton = screen.getByRole("button", { name: "增大图片高度" });
    
    expect(decreaseButton).toBeInTheDocument();
    expect(increaseButton).toBeInTheDocument();
  });
});
