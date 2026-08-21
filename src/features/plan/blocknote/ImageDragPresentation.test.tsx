// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  EmptyImageGroupDropSlot,
  ImageDragSourcePlaceholder,
  ImageDragTargetGroup,
  ImageDragTargetInsertion,
} from "./ImageDragPresentation";
import { createImageDragMotionStyle } from "../imageDragMotion";

describe("image drag presentation", () => {
  it("keeps source and target placeholders visible but pointer transparent", () => {
    render(
      <>
        <ImageDragSourcePlaceholder height={80} width={120} />
        <ImageDragTargetInsertion height={90} width={140} />
      </>,
    );

    const source = document.querySelector<HTMLElement>(
      "[data-image-drag-source-placeholder]",
    )!;
    const target = document.querySelector<HTMLElement>(
      "[data-image-drag-target-insertion]",
    )!;
    expect(source).toHaveClass("preshot-image-drag-source-placeholder");
    expect(source).toHaveAttribute("aria-hidden", "true");
    expect(source).toHaveStyle({ height: "80px", width: "120px" });
    expect(target).toHaveClass("preshot-image-drag-target-insertion");
    expect(target).toHaveStyle({ height: "90px", width: "140px" });
  });

  it("presents cyan target-group and empty-group states", () => {
    render(
      <>
        <ImageDragTargetGroup active data-testid="target-group">
          target
        </ImageDragTargetGroup>
        <EmptyImageGroupDropSlot active data-testid="empty-slot" />
      </>,
    );

    const group = document.querySelector<HTMLElement>(
      '[data-testid="target-group"]',
    )!;
    expect(group).toHaveClass("preshot-image-drag-target-group-active");
    expect(group).toHaveAttribute("data-image-drag-target", "true");
    expect(group.getAttribute("style")).toContain(
      "background-color: var(--app-functional-soft)",
    );
    expect(group.getAttribute("style")).toContain(
      "border-color: var(--app-functional)",
    );
    expect(
      document.querySelector('[data-testid="empty-slot"]'),
    ).toHaveClass("preshot-image-drag-empty-slot-active");
  });

  it("never adds left/top motion to an active drag tile", () => {
    const style = createImageDragMotionStyle({
      isDragging: true,
      prefersReducedMotion: false,
      opacity: 0.5,
      transform: "translate3d(10px, 20px, 0)",
    });
    expect(style.transition).toBe(
      "transform 200ms ease-out, opacity 200ms ease-out",
    );
    expect(style.transition).not.toMatch(/\b(?:left|top)\b/);
  });
});
