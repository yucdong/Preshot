import { describe, expect, it } from "vitest";
import {
  DRAG_ACTIVATION_CONSTRAINT,
  createMotionStyleTransition,
} from "./dragMotion";

describe("dragMotion", () => {
  it("uses the delayed activation constraint requested by task 7", () => {
    expect(DRAG_ACTIVATION_CONSTRAINT).toEqual({ delay: 180, tolerance: 6 });
  });

  it("returns a 200ms ease-out layout transition unless motion is reduced", () => {
    expect(createMotionStyleTransition(false)).toContain("200ms ease-out");
    expect(createMotionStyleTransition(true)).toBeUndefined();
  });

  it("uses transform and opacity only while the tile is actively dragging", () => {
    const transition = createMotionStyleTransition(
      false,
      "transform 200ms ease",
      true,
    );
    expect(transition).toBe(
      "transform 200ms ease-out, opacity 200ms ease-out",
    );
    expect(transition).not.toMatch(/\b(?:left|top|width|height)\b/);
  });
});
