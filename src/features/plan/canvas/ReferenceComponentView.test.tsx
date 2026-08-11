// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { SettingsRepository } from "../../../domain/settings/ports";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import { packReferenceFrames } from "../../../domain/plan/canvas/referenceLayout";
import { maximumFittingReferenceAverageHeight } from "../../../domain/plan/canvas/referenceContinuation";
import { ReferenceComponentView } from "./ReferenceComponentView";

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: () => undefined }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  rectSortingStrategy: () => null,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

const component: ReferenceComponent = {
  id: "ref",
  name: "Reference",
  type: "reference",
  x: 0,
  width: 320,
  height: 240,
  description: "",
  images: [{
    id: "image",
    file: "references/image.png",
    caption: "legacy caption",
    aspectRatio: 1,
    frameWidth: 100,
    frameHeight: 100,
  }],
};

const settings: SettingsRepository = {
  read: vi.fn().mockResolvedValue({ theme: "light" }),
  write: vi.fn().mockResolvedValue(undefined),
};

function renderView(
  componentOverride: ReferenceComponent = component,
  callbacks: {
    onSetImageFrame?: (
      componentId: string,
      imageId: string,
      frame: { frameWidth: number; frameHeight: number },
    ) => void;
    onAddImages?: (componentId: string) => void;
    onCaptureImage?: (componentId: string) => void;
    onScaleImages?: (componentId: string, scale: number) => void;
  } = {},
) {
  return render(
    <ThemeProvider repository={settings}>
      <ReferenceComponentView
        component={componentOverride}
        enableReorder
        imageSrc={() => undefined}
        onAddImage={vi.fn()}
        onAddImages={callbacks.onAddImages}
        onCaptureImage={callbacks.onCaptureImage}
        onOpenImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onSetDescription={vi.fn()}
        onSetImageFrame={callbacks.onSetImageFrame}
        onScaleImages={callbacks.onScaleImages}
        scale={1}
        slots={packReferenceFrames({ images: componentOverride.images, innerWidth: 296 })}
      />
    </ThemeProvider>,
  );
}

describe("ReferenceComponentView", () => {
  it("hides an empty group introduction while exposing an accessible add action", () => {
    renderView();
    expect(screen.queryByRole("group", { name: "分组描述" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加图组介绍" }));
    expect(screen.getByRole("group", { name: "分组描述" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "隐藏" })).not.toBeInTheDocument();
  });

  it("renders a nonempty rich-text introduction with its visible prefix", () => {
    renderView({ ...component, description: "<p>柔和逆光</p>" });

    expect(screen.getByText("图组介绍")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "分组描述" })).toBeInTheDocument();
  });

  it("renders image frames without rendering legacy captions", () => {
    renderView();
    expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("legacy caption")).not.toBeInTheDocument();
  });

  it("keeps reference-card content non-scrolling so complete rows drive component height", () => {
    renderView();
    expect(screen.getByTestId("reference-component-content")).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("reference-component-content")).not.toHaveClass("overflow-auto");
  });

  it("uses shared toolbar import and capture actions", () => {
    const onAddImages = vi.fn();
    const onCaptureImage = vi.fn();
    renderView(component, { onAddImages, onCaptureImage });

    const toolbar = screen.getByTestId("reference-title-row");
    fireEvent.click(within(toolbar).getByRole("button", { name: "添加参考图" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "截图" }));
    expect(within(toolbar).getByTestId("screenshot-icon")).toHaveAttribute(
      "data-icon",
      "scissors",
    );
    expect(onAddImages).toHaveBeenCalledWith("ref");
    expect(onCaptureImage).toHaveBeenCalledWith("ref");
  });

  it("adjusts proportional whole-group image sizing with 4pt step buttons", () => {
    const onScaleImages = vi.fn();
    const twoImages: ReferenceComponent = {
      ...component,
      images: [
        component.images[0],
        {
          id: "image-2",
          file: "references/image-2.png",
          aspectRatio: 1,
          frameWidth: 100,
          frameHeight: 100,
        },
      ],
    };
    renderView(twoImages, { onScaleImages });

    const toolbar = screen.getByTestId("reference-title-row");
    const capture = within(toolbar).getByRole("button", { name: "截图" });
    const decrease = within(toolbar).getByRole("button", { name: "减小整体图片高度" });
    const increase = within(toolbar).getByRole("button", { name: "增大整体图片高度" });
    expect(capture.compareDocumentPosition(decrease) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(toolbar).queryByRole("slider")).not.toBeInTheDocument();
    expect(within(toolbar).getByRole("spinbutton", { name: "整体图片高度（像素）" })).toHaveValue(133);

    fireEvent.click(decrease);
    expect(onScaleImages).toHaveBeenCalledWith("ref", 0.96);
    expect(within(toolbar).getByRole("spinbutton", { name: "整体图片高度（像素）" })).toHaveValue(133);

    expect(increase).not.toBeDisabled();
  });

  it("commits valid pixel input and restores an invalid value", () => {
    const onScaleImages = vi.fn();
    renderView(component, { onScaleImages });
    const input = screen.getByRole("spinbutton", { name: "整体图片高度（像素）" });

    fireEvent.change(input, { target: { value: "160" } });
    fireEvent.blur(input);
    expect(onScaleImages).toHaveBeenCalledWith("ref", 1.2);

    onScaleImages.mockClear();
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.blur(input);
    expect(onScaleImages).not.toHaveBeenCalled();
    expect(input).toHaveValue(133);
    expect(screen.getByRole("alert")).toHaveTextContent(/请输入 32-/);
  });

  it("disables group image growth at the largest whole-page size", () => {
    const onScaleImages = vi.fn();
    const base = {
      ...component,
      images: Array.from({ length: 30 }, (_, index) => ({
        id: `image-${index}`,
        file: `references/${index}.png`,
        aspectRatio: 1,
        frameWidth: 24,
        frameHeight: 24,
      })),
    };
    const maximum = maximumFittingReferenceAverageHeight(base, { minimum: 24, step: 4 });
    const atMaximum = {
      ...base,
      images: base.images.map((image) => ({
        ...image,
        frameWidth: maximum,
        frameHeight: maximum,
      })),
    };
    renderView(atMaximum, { onScaleImages });

    const increase = screen.getByRole("button", { name: "增大整体图片高度" });
    expect(increase).toBeDisabled();
  });

  it("live-reflows following frames while resizing and persists the final dimensions", () => {
    const onSetImageFrame = vi.fn();
    const twoImages: ReferenceComponent = {
      ...component,
      images: [
        component.images[0],
        {
          id: "image-2",
          file: "references/image-2.png",
          aspectRatio: 1,
          frameWidth: 80,
          frameHeight: 100,
        },
      ],
    };
    renderView(twoImages, { onSetImageFrame });

    const right = document.querySelector(
      '[data-image-id="image"] [data-image-resize-handle="right"]',
    ) as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    right.setPointerCapture = vi.fn();
    right.hasPointerCapture = vi.fn().mockReturnValue(true);
    right.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(right, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 120, pointerId: 1 });

    expect(screen.getByTestId("image-tile-image-2")).toHaveStyle({ left: "132px" });

    fireEvent.pointerUp(right, { pointerId: 1 });
    expect(onSetImageFrame).toHaveBeenCalledWith("ref", "image", {
      frameWidth: 120,
      frameHeight: 100,
    });
  });

  it("renders and clears image snap guides during a resize preview", () => {
    const twoImages: ReferenceComponent = {
      ...component,
      images: [
        component.images[0],
        {
          id: "image-2",
          file: "references/image-2.png",
          aspectRatio: 1,
          frameWidth: 80,
          frameHeight: 100,
        },
      ],
    };
    renderView(twoImages);

    const right = document.querySelector(
      '[data-image-id="image"] [data-image-resize-handle="right"]',
    ) as HTMLElement & {
      setPointerCapture(pointerId: number): void;
      hasPointerCapture(pointerId: number): boolean;
      releasePointerCapture(pointerId: number): void;
    };
    right.setPointerCapture = vi.fn();
    right.hasPointerCapture = vi.fn().mockReturnValue(true);
    right.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(right, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 108, pointerId: 1 });

    expect(screen.getByTestId("image-alignment-guide-vertical")).toHaveStyle({
      left: "112px",
    });

    fireEvent.pointerCancel(right, { pointerId: 1 });
    expect(screen.queryByTestId("image-alignment-guide-vertical")).not.toBeInTheDocument();
  });
});
