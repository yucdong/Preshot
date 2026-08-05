import { describe, expect, it } from "vitest";
import type { ComponentFragmentPlacement } from "../../../domain/plan/canvas/engine";
import { pageCountForDisplayedPlacements } from "./dragPreviewState";

const placement = (pageIndex: number): ComponentFragmentPlacement => ({
  fragmentId: `c::${pageIndex}`,
  componentId: "c",
  fragmentIndex: pageIndex,
  kind: "whole",
  pageIndex,
  rect: { x: 0, y: 0, width: 100, height: 100 },
});

describe("pageCountForDisplayedPlacements", () => {
  it("keeps enough page backgrounds for displayed placements during drag previews", () => {
    expect(pageCountForDisplayedPlacements([placement(1)], 1)).toBe(2);
  });

  it("falls back to the layout page count when no placements are displayed", () => {
    expect(pageCountForDisplayedPlacements([], 3)).toBe(3);
  });
});
