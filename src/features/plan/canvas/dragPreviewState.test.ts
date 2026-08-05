import { describe, expect, it } from "vitest";
import type { ComponentFragmentPlacement } from "../../../domain/plan/canvas/engine";
import { buildDisplayPlacements, pageCountForDisplayedPlacements } from "./dragPreviewState";

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

describe("buildDisplayPlacements", () => {
  it("pins the base continuation fragment and keeps trailing content on its original page during image preview", () => {
    const basePlacements: ComponentFragmentPlacement[] = [
      {
        fragmentId: "source::0",
        componentId: "source",
        fragmentIndex: 0,
        kind: "first",
        pageIndex: 0,
        rect: { x: 0, y: 0, width: 100, height: 120 },
      },
      {
        fragmentId: "target::0",
        componentId: "target",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 0,
        rect: { x: 0, y: 160, width: 100, height: 80 },
      },
      {
        fragmentId: "source::1",
        componentId: "source",
        fragmentIndex: 1,
        kind: "continuation",
        pageIndex: 1,
        rect: { x: 0, y: 0, width: 100, height: 120 },
      },
      {
        fragmentId: "trailing::0",
        componentId: "trailing",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 2,
        rect: { x: 0, y: 0, width: 100, height: 80 },
      },
    ];
    const previewPlacements: ComponentFragmentPlacement[] = [
      {
        fragmentId: "source::0",
        componentId: "source",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 0,
        rect: { x: 0, y: 0, width: 100, height: 120 },
      },
      {
        fragmentId: "target::0",
        componentId: "target",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 0,
        rect: { x: 0, y: 160, width: 100, height: 140 },
      },
      {
        fragmentId: "trailing::0",
        componentId: "trailing",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 1,
        rect: { x: 0, y: 0, width: 100, height: 80 },
      },
    ];
    const originPlacement = basePlacements[2]!;

    const displayPlacements = buildDisplayPlacements({
      activeDrag: { type: "image", componentId: "source" },
      basePlacements,
      previewPlacements,
      imageOriginPlacement: originPlacement,
    });
    const trailingDisplayPlacement = displayPlacements.find((candidate) => candidate.componentId === "trailing");

    expect(previewPlacements.some((candidate) => candidate.fragmentId === originPlacement.fragmentId)).toBe(false);
    expect(displayPlacements).toContainEqual(originPlacement);
    expect(trailingDisplayPlacement?.pageIndex).toBe(2);
  });
});
