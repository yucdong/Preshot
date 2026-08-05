import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  COMPONENT_INSET,
  REFERENCE_CONTINUATION_HEADER_HEIGHT,
  REFERENCE_HEADER_HEIGHT,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { ReferenceComponentView } from "./ReferenceComponentView";

vi.mock("../RichTextEditor", () => ({
  RichTextEditor: ({ rootRef }: { rootRef?: React.Ref<HTMLDivElement> }) => <div data-testid="rich-text-editor" ref={rootRef} />,
}));

const groupImageGridMock = vi.fn<(props: unknown) => ReactElement>((_props) => <div data-testid="group-image-grid" />);

vi.mock("../GroupImageGrid", () => ({
  GroupImageGrid: (props: unknown) => groupImageGridMock(props),
}));

const mockComponent: ReferenceComponent = {
  id: "ref-1",
  type: "reference",
  width: 1,
  title: "Test Reference",
  description: "",
  showCaptions: false, imageHeight: 180, images: [],
};

const mockSlots: ReferenceFlowSlot[] = [
  { kind: "image", id: "i1", x: 0, y: 0, width: 160, height: 120, imageHeight: 120, captionHeight: 0 },
  { kind: "add", id: "__add__", x: 0, y: 132, width: 120, height: 90, imageHeight: 90, captionHeight: 0 },
];

function renderReference(overrides: Partial<Parameters<typeof ReferenceComponentView>[0]> = {}) {
  return render(
    <ReferenceComponentView
      component={mockComponent}
      imageSrc={() => undefined}
      onSetTitle={vi.fn()}
      onSetDescription={vi.fn()}
      onAddImage={vi.fn()}
      onRemoveImage={vi.fn()}
      onOpenImage={vi.fn()}
      slots={mockSlots}
      scale={1}
      {...overrides}
    />,
  );
}

describe("ReferenceComponentView", () => {
  it("does not render an internal scrolling region", () => {
    renderReference();
    expect(screen.getByTestId("reference-component-body")).not.toHaveClass("overflow-auto");
  });

  it("renders a continuation title without editable controls", () => {
    renderReference({
      component: { ...mockComponent, title: "Lookbook", description: "<p>desc</p>" },
      fragmentKind: "continuation",
      fragmentIndex: 1,
    });

    expect(screen.getByText("Lookbook（续）")).toBeVisible();
    expect(screen.queryByLabelText("分组标题")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "显示说明" })).toBeNull();
    expect(screen.queryByTestId("rich-text-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加描述" })).toBeNull();
  });

  it.each([0.5, 1.75])(
    "renders first-fragment title and controls from shared point geometry at scale %s",
    (scale) => {
      renderReference({ onToggleCaptions: vi.fn(), onSetImageHeight: vi.fn(), scale });

      const content = screen.getByTestId("reference-component-content");
      const titleRow = screen.getByTestId("reference-title-row");
      const controlRow = screen.getByTestId("reference-control-row");
      const headerGap = 6;
      const titleHeight = 24;
      const controlHeight = 18;

      expect(content.style.paddingTop).toBe(`${COMPONENT_INSET * scale}px`);
      expect(content.style.paddingBottom).toBe(`${COMPONENT_INSET * scale}px`);
      expect(titleRow.style.height).toBe(`${titleHeight * scale}px`);
      expect(controlRow.style.height).toBe(`${controlHeight * scale}px`);
      expect(controlRow.style.marginTop).toBe(`${headerGap * scale}px`);
      expect(controlRow.style.marginBottom).toBe(`${headerGap * scale}px`);
      expect(titleHeight + headerGap + controlHeight + headerGap).toBe(
        REFERENCE_HEADER_HEIGHT,
      );
    },
  );

  it.each([0.5, 1.75])(
    "renders continuation heading from shared point geometry at scale %s",
    (scale) => {
      renderReference({
        component: { ...mockComponent, title: "Lookbook" },
        fragmentKind: "continuation",
        fragmentIndex: 1,
        scale,
      });

      const title = screen.getByTestId("reference-continuation-title");
      expect(title.style.height).toBe(`${18 * scale}px`);
      expect(title.style.marginBottom).toBe(`${6 * scale}px`);
      expect(18 + 6).toBe(REFERENCE_CONTINUATION_HEADER_HEIGHT);
    },
  );

  it("passes fragment metadata and reference flow slots to the image grid", () => {
    renderReference({
      fragmentKind: "continuation",
      fragmentIndex: 2,
      slots: mockSlots,
    });

    expect(groupImageGridMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slots: mockSlots,
        scale: 1,
      }),
    );
  });

  it("renders a caption toggle checkbox with correct accessible name", () => {
    const onToggleCaptions = vi.fn();

    renderReference({ onToggleCaptions });

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("reflects showCaptions state in the checkbox", () => {
    const onToggleCaptions = vi.fn();

    renderReference({ component: { ...mockComponent, showCaptions: true }, onToggleCaptions });

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    expect(checkbox).toBeChecked();
  });

  it("calls onToggleCaptions with component id when toggled", async () => {
    const onToggleCaptions = vi.fn();
    const user = userEvent.setup();

    renderReference({ onToggleCaptions });

    const checkbox = screen.getByRole("checkbox", { name: "显示说明" });
    await user.click(checkbox);

    expect(onToggleCaptions).toHaveBeenCalledWith("ref-1");
    expect(onToggleCaptions).toHaveBeenCalledTimes(1);
  });

  it("renders 添加描述 button when description is empty and no editor", () => {
    renderReference();

    const button = screen.getByRole("button", { name: "添加描述" });
    expect(button).toBeInTheDocument();
    expect(screen.queryByTestId("rich-text-editor")).not.toBeInTheDocument();
  });

  it("reveals editor when 添加描述 button is clicked", async () => {
    const user = userEvent.setup();

    renderReference();

    const button = screen.getByRole("button", { name: "添加描述" });
    await user.click(button);

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加描述" })).not.toBeInTheDocument();
  });

  it("renders editor when description is non-empty and no button", () => {
    renderReference({ component: { ...mockComponent, description: "<p>Some description</p>" } });

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加描述" })).not.toBeInTheDocument();
  });

  it("does not render columns select control", () => {
    renderReference({ onSetImageHeight: vi.fn(), onAddImages: vi.fn() });

    expect(screen.queryByLabelText("每行图片数:")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders image-height stepper with - and + buttons", () => {
    renderReference({ onSetImageHeight: vi.fn(), onAddImages: vi.fn() });

    expect(screen.getByText("图片高度")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "减小图片高度" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "增大图片高度" })).toBeInTheDocument();
  });

  it("calls onSetImageHeight when + button is clicked", async () => {
    const onSetImageHeight = vi.fn();
    const user = userEvent.setup();

    renderReference({
      component: { ...mockComponent, imageHeight: 180 },
      onSetImageHeight,
      onAddImages: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "增大图片高度" }));
    expect(onSetImageHeight).toHaveBeenCalledWith("ref-1", 195);
  });

  it("calls onSetImageHeight when - button is clicked", async () => {
    const onSetImageHeight = vi.fn();
    const user = userEvent.setup();

    renderReference({
      component: { ...mockComponent, imageHeight: 180 },
      onSetImageHeight,
      onAddImages: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: "减小图片高度" }));
    expect(onSetImageHeight).toHaveBeenCalledWith("ref-1", 165);
  });

  it("uses i18n keys for stepper button aria-labels", () => {
    // TDD: Test for Finding 4 - should use translated labels
    renderReference({ onSetImageHeight: vi.fn(), onAddImages: vi.fn() });

    // These buttons should use i18n translated labels
    const decreaseButton = screen.getByRole("button", { name: "减小图片高度" });
    const increaseButton = screen.getByRole("button", { name: "增大图片高度" });
    
    expect(decreaseButton).toBeInTheDocument();
    expect(increaseButton).toBeInTheDocument();
  });
});
