import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  COMPONENT_INSET,
  REFERENCE_HEADER_HEIGHT,
  type ReferenceFlowSlot,
} from "../../../domain/plan/canvas/referenceLayout";
import { ReferenceComponentView } from "./ReferenceComponentView";

const usePlanContentMeasurementMock = vi.hoisted(() =>
  vi.fn(() => ({ rootRef: { current: null } })),
);

vi.mock("../RichTextEditor", () => ({
  RichTextEditor: ({ rootRef }: { rootRef?: React.Ref<HTMLDivElement> }) => <div data-testid="rich-text-editor" ref={rootRef} />,
}));

vi.mock("./usePlanContentMeasurement", () => ({
  usePlanContentMeasurement: usePlanContentMeasurementMock,
}));

const groupImageGridMock = vi.fn<(props: unknown) => ReactElement>((_props) => <div data-testid="group-image-grid" />);

vi.mock("../GroupImageGrid", () => ({
  GroupImageGrid: (props: unknown) => groupImageGridMock(props),
}));

const mockComponent: ReferenceComponent = {
  id: "ref-1",
  type: "reference",
  width: 1,
  contentScale: 1,
  name: "Test Reference",
  description: "",
  showDescription: true,
imageHeight: 180, images: [],
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
  beforeEach(() => {
    usePlanContentMeasurementMock.mockClear();
  });

  it("does not render an internal scrolling region", () => {
    renderReference();
    expect(screen.getByTestId("reference-component-body")).not.toHaveClass("overflow-auto");
  });

  it("does not render a duplicate editable group title", () => {
    renderReference();

    expect(screen.queryByRole("textbox", { name: "分组标题" })).not.toBeInTheDocument();
  });

  it("places import and screenshot actions on the left and image sizing on the right", async () => {
    const onAddImages = vi.fn();
    const onCaptureImage = vi.fn();
    const user = userEvent.setup();
    renderReference({
      onAddImages,
      onCaptureImage,
      onSetImageHeight: vi.fn(),
    });

    const toolbar = screen.getByTestId("reference-title-row");
    const importButton = within(toolbar).getByRole("button", { name: "添加参考图" });
    const captureButton = within(toolbar).getByRole("button", { name: "截图" });
    const decreaseButton = within(toolbar).getByRole("button", { name: "减小图片高度" });
    expect(importButton.parentElement).toHaveClass("order-first");
    expect(decreaseButton.parentElement).toHaveClass("ml-auto");
    expect(importButton).toHaveAttribute("title", "导入图片");
    expect(captureButton).toHaveAttribute("title", "截图");
    expect(screen.getByTestId("screenshot-icon").querySelector("path")).toHaveAttribute(
      "stroke",
      "currentColor",
    );

    await user.click(importButton);
    await user.click(captureButton);
    expect(onAddImages).toHaveBeenCalledWith("ref-1");
    expect(onCaptureImage).toHaveBeenCalledWith("ref-1");
  });

  it("shows import progress and capture cancellation in the toolbar controls", async () => {
    const onCancelCapture = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderReference({
      importProgress: { completed: 1, total: 3, failed: 1 },
      onCancelCapture,
    });

    expect(screen.getByRole("progressbar", { name: "图片导入进度" })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(screen.getByText("已处理 1/3（1 张失败）")).toBeVisible();

    rerender(
      <ReferenceComponentView
        component={mockComponent}
        imageSrc={() => undefined}
        onSetDescription={vi.fn()}
        onAddImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onOpenImage={vi.fn()}
        onCancelCapture={onCancelCapture}
        captureStatus="waiting"
        slots={mockSlots}
        scale={1}
      />,
    );
    await user.click(screen.getByRole("button", { name: "取消截图" }));
    expect(onCancelCapture).toHaveBeenCalledTimes(1);
  });

  it("renders continuation images without a repeated title or editable controls", () => {
    renderReference({
      component: { ...mockComponent, name: "Lookbook", description: "<p>desc</p>" },
      fragmentKind: "continuation",
      fragmentIndex: 1,
    });

    expect(screen.queryByText("Lookbook（续）")).toBeNull();
    expect(screen.queryByTestId("reference-continuation-title")).toBeNull();
    expect(screen.queryByLabelText("分组标题")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "隐藏" })).toBeNull();
    expect(screen.queryByTestId("rich-text-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加描述" })).toBeNull();
  });

  it.each([0.5, 1.75])(
    "renders first-fragment title and controls from shared point geometry at scale %s",
    (scale) => {
      renderReference({ onToggleDescription: vi.fn(), onSetImageHeight: vi.fn(), scale });

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

  it("renders a checked-means-hidden description checkbox", () => {
    const onToggleDescription = vi.fn();

    renderReference({ onToggleDescription });

    const checkbox = screen.getByRole("checkbox", { name: "隐藏" });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("reflects hidden descriptions in the checkbox", () => {
    const onToggleDescription = vi.fn();

    renderReference({ component: { ...mockComponent, showDescription: false }, onToggleDescription });

    const checkbox = screen.getByRole("checkbox", { name: "隐藏" });
    expect(checkbox).toBeChecked();
  });

  it("calls onToggleDescription with component id when toggled", async () => {
    const onToggleDescription = vi.fn();
    const user = userEvent.setup();

    renderReference({ onToggleDescription });

    const checkbox = screen.getByRole("checkbox", { name: "隐藏" });
    await user.click(checkbox);

    expect(onToggleDescription).toHaveBeenCalledWith("ref-1");
    expect(onToggleDescription).toHaveBeenCalledTimes(1);
  });

  it("renders the editable description while it is visible, including when empty", () => {
    renderReference();

    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
  });

  it("omits the editor when the description is hidden", () => {
    renderReference({ component: { ...mockComponent, showDescription: false } });

    expect(screen.queryByTestId("rich-text-editor")).not.toBeInTheDocument();
  });

  it("reuses paged BlockNote measurement for the editable description", () => {
    const onMeasureDescription = vi.fn();
    const description = "<p>Some description</p>";

    renderReference({
      component: { ...mockComponent, description },
      onMeasureDescription,
    });

    expect(usePlanContentMeasurementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: "ref-1",
        contentKey: description,
        scale: 1,
        contentHeightPoints: expect.any(Number),
      }),
    );

    const calls = usePlanContentMeasurementMock.mock.calls as unknown as Array<
      [
        {
          onMeasure(
            id: string,
            measurement: {
              heightPoints: number;
              pageBreakBeforeBlockIds: string[];
            },
          ): void;
        },
      ]
    >;
    const input = calls.at(-1)?.[0];
    input?.onMeasure("ref-1", {
      heightPoints: 912,
      pageBreakBeforeBlockIds: ["ref-1:block-4"],
    });

    expect(onMeasureDescription).toHaveBeenCalledWith("ref-1", 912);
  });

  it("does not render columns select control", () => {
    renderReference({ onSetImageHeight: vi.fn(), onAddImages: vi.fn() });

    expect(screen.queryByLabelText("每行图片数:")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders image-size stepper with - and + buttons", () => {
    renderReference({ onSetImageHeight: vi.fn(), onAddImages: vi.fn() });

    expect(screen.getByText("图片尺寸")).toBeInTheDocument();
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
