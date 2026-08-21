import { describe, expect, it } from "vitest";
import {
  createImageDragTransition,
  imageDragDropAnimation,
  imageDragAutoScrollVelocity,
  imageDragOverlayGeometry,
  IMAGE_DRAG_TOKENS,
} from "./imageDragMotion";

describe("image drag motion", () => {
  it("publishes the shared activation, motion, overlay, and auto-scroll tokens", () => {
    expect(IMAGE_DRAG_TOKENS).toMatchObject({
      mouseActivationDistance: 6,
      touchActivationDelayMs: 180,
      touchActivationTolerance: 6,
      reflowDurationMs: 200,
      dropDurationMs: 200,
      easing: "ease-out",
      overlayWidth: 176,
      autoScrollEdge: 48,
      autoScrollHysteresis: 8,
    });

    expect(IMAGE_DRAG_TOKENS.targetBorderColor).toBe("var(--app-functional)");
    expect(IMAGE_DRAG_TOKENS.targetBackgroundColor).toBe(
      "var(--app-functional-soft)",
    );
  });

  it.each([0.55, 0.85, 1, 1.8])(
    "keeps the 48 CSS-pixel auto-scroll band invariant at zoom %s",
    () => {
      const viewport = { left: 100, right: 900, top: 50, bottom: 650 };
      expect(imageDragAutoScrollVelocity(
        { x: 120, y: 626 },
        viewport,
      )).toEqual({ x: -10.5, y: 9 });
      expect(imageDragAutoScrollVelocity(
        { x: 148, y: 602 },
        viewport,
      )).toEqual({ x: 0, y: 0 });
    },
  );

  it("separates transform-only drag motion from layout reflow motion", () => {
    const dragging = createImageDragTransition({
      isDragging: true,
      prefersReducedMotion: false,
    });
    expect(dragging).toBe(
      "transform 200ms ease-out, opacity 200ms ease-out",
    );
    expect(dragging).not.toMatch(/\b(?:left|top|width|height)\b/);

    const layout = createImageDragTransition({
      isDragging: false,
      prefersReducedMotion: false,
    });
    expect(layout).toBe(
      "left 200ms ease-out, top 200ms ease-out, width 200ms ease-out, height 200ms ease-out, opacity 200ms ease-out, border-color 200ms ease-out, background-color 200ms ease-out",
    );
  });

  it("disables transition and drop durations for reduced motion", () => {
    expect(
      createImageDragTransition({
        isDragging: true,
        prefersReducedMotion: true,
      }),
    ).toBe("none");
    expect(imageDragDropAnimation(true)).toEqual({
      duration: 0,
      easing: "ease-out",
    });
  });

  it("uses real frame dimensions before falling back to source aspect ratio", () => {
    expect(
      imageDragOverlayGeometry({
        aspectRatio: 3,
        frameWidth: 200,
        frameHeight: 100,
      }),
    ).toEqual({ width: 176, height: 88 });
    expect(
      imageDragOverlayGeometry({
        aspectRatio: 2,
        frameWidth: 0,
        frameHeight: 0,
      }),
    ).toEqual({ width: 176, height: 88 });
  });
});
