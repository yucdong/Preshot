import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageCropOverlay } from "./ImageCropOverlay";

function renderOverlay(overrides: Partial<Parameters<typeof ImageCropOverlay>[0]> = {}) {
  const props = {
    crop: undefined,
    sourceAspectRatio: 1,
    viewportWidth: 100,
    viewportHeight: 100,
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };

  render(<ImageCropOverlay {...props} />);
  return props;
}

describe("ImageCropOverlay", () => {
  it("previews and commits a normalized right-edge drag once", () => {
    const props = renderOverlay();
    const handle = screen.getByTestId("crop-handle-right");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 80, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 80, clientY: 50 });

    expect(props.onPreview).toHaveBeenCalledWith({ x: 0, y: 0, width: 0.8, height: 1 });
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith({ x: 0, y: 0, width: 0.8, height: 1 });
  });

  it("updates the top edge using the viewport height", () => {
    const props = renderOverlay();
    const handle = screen.getByTestId("crop-handle-top");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50, clientY: 20 });

    expect(props.onCommit).toHaveBeenCalledWith({ x: 0, y: 0.2, width: 1, height: 0.8 });
  });

  it.each([
    ["left", { clientX: 0, clientY: 50 }, { clientX: 20, clientY: 50 }, { x: 0.2, y: 0, width: 0.8, height: 1 }],
    ["right", { clientX: 100, clientY: 50 }, { clientX: 80, clientY: 50 }, { x: 0, y: 0, width: 0.8, height: 1 }],
    ["top", { clientX: 50, clientY: 0 }, { clientX: 50, clientY: 20 }, { x: 0, y: 0.2, width: 1, height: 0.8 }],
    ["bottom", { clientX: 50, clientY: 100 }, { clientX: 50, clientY: 80 }, { x: 0, y: 0, width: 1, height: 0.8 }],
  ] as const)(
    "commits the expected crop from the %s edge",
    (edge, start, end, expected) => {
      const props = renderOverlay();
      const handle = screen.getByTestId(`crop-handle-${edge}`);

      fireEvent.pointerDown(handle, { pointerId: 1, ...start });
      fireEvent.pointerMove(handle, { pointerId: 1, ...end });
      fireEvent.pointerUp(handle, { pointerId: 1, ...end });

      expect(props.onCommit).toHaveBeenCalledWith(expected);
    },
  );

  it("cancels a drag without committing when pointer capture is cancelled", () => {
    const props = renderOverlay();
    const handle = screen.getByTestId("crop-handle-right");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 80, clientY: 50 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("cancels a drag when it loses pointer capture", () => {
    const props = renderOverlay();
    const handle = screen.getByTestId("crop-handle-right");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.lostPointerCapture(handle, { pointerId: 1 });

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it.each([
    [
      "right",
      { clientX: 100, clientY: 50 },
      { clientX: 75, clientY: 50 },
      { viewportWidth: 75, viewportHeight: 100 },
      { x: 0, y: 0, width: 0.75, height: 1 },
    ],
    [
      "left",
      { clientX: 0, clientY: 50 },
      { clientX: 25, clientY: 50 },
      { viewportWidth: 75, viewportHeight: 100 },
      { x: 0.25, y: 0, width: 0.75, height: 1 },
    ],
    [
      "bottom",
      { clientX: 50, clientY: 100 },
      { clientX: 50, clientY: 75 },
      { viewportWidth: 100, viewportHeight: 75 },
      { x: 0, y: 0, width: 1, height: 0.75 },
    ],
    [
      "top",
      { clientX: 50, clientY: 0 },
      { clientX: 50, clientY: 25 },
      { viewportWidth: 100, viewportHeight: 75 },
      { x: 0, y: 0.25, width: 1, height: 0.75 },
    ],
  ] as const)(
    "keeps the pointer-down viewport for a reflowed %s-edge drag",
    (edge, start, end, reflowedViewport, expected) => {
      const props = {
        crop: undefined,
        sourceAspectRatio: 1,
        viewportWidth: 100,
        viewportHeight: 100,
        onPreview: vi.fn(),
        onCommit: vi.fn(),
        onCancel: vi.fn(),
        onReset: vi.fn(),
      };
      const { rerender } = render(<ImageCropOverlay {...props} />);
      const handle = screen.getByTestId(`crop-handle-${edge}`);

      fireEvent.pointerDown(handle, { pointerId: 1, ...start });
      fireEvent.pointerMove(handle, { pointerId: 1, ...end });
      rerender(<ImageCropOverlay {...props} {...reflowedViewport} />);
      fireEvent.pointerMove(handle, { pointerId: 1, ...end });
      fireEvent.pointerUp(handle, { pointerId: 1, ...end });

      expect(props.onPreview).toHaveBeenLastCalledWith(expected);
      expect(props.onCommit).toHaveBeenCalledWith(expected);
    },
  );

  it("cancels a reflowed drag without committing a crop", () => {
    const props = {
      crop: undefined,
      sourceAspectRatio: 1,
      viewportWidth: 100,
      viewportHeight: 100,
      onPreview: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
      onReset: vi.fn(),
    };
    const { rerender } = render(<ImageCropOverlay {...props} />);
    const handle = screen.getByTestId("crop-handle-right");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 75, clientY: 50 });
    rerender(<ImageCropOverlay {...props} viewportWidth={75} />);
    fireEvent.pointerCancel(handle, { pointerId: 1 });

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("shows reset only when the image has a crop", () => {
    const { rerender } = render(
      <ImageCropOverlay
        crop={undefined}
        sourceAspectRatio={1}
        viewportWidth={100}
        viewportHeight={100}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "恢复原图" })).toBeNull();

    rerender(
      <ImageCropOverlay
        crop={{ x: 0.1, y: 0, width: 0.9, height: 1 }}
        sourceAspectRatio={1}
        viewportWidth={100}
        viewportHeight={100}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "恢复原图" })).toBeVisible();
  });
});
