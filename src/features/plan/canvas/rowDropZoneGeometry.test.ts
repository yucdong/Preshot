import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TITLE_HEIGHT,
} from "../../../domain/plan/canvas/models";
import { SPACING } from "../../../domain/plan/canvas/geometry";
import type { ComponentFragmentPlacement } from "../../../domain/plan/canvas/engine";
import { pageTopPx } from "./pagedCanvasMetrics";
import { rowDropZoneGeometry } from "./rowDropZoneGeometry";

const rows: Array<{ componentIds: string[] }> = [
  { componentIds: ["first"] },
  { componentIds: ["second"] },
];

const placements: ComponentFragmentPlacement[] = [
  {
    fragmentId: "first::0",
    componentId: "first",
    fragmentIndex: 0,
    kind: "whole",
    pageIndex: 0,
    rect: { x: 0, y: DOCUMENT_TITLE_HEIGHT + SPACING, width: 100, height: 100 },
  },
  {
    fragmentId: "second::0",
    componentId: "second",
    fragmentIndex: 0,
    kind: "whole",
    pageIndex: 0,
    rect: { x: 0, y: DOCUMENT_TITLE_HEIGHT + SPACING + 100 + SPACING, width: 100, height: 80 },
  },
];

describe("rowDropZoneGeometry", () => {
  it.each([0.5, 1.75])(
    "uses scaled point gaps before, between, and after rows at scale %s",
    (scale) => {
      expect(rowDropZoneGeometry(rows, placements, scale)).toEqual([
        {
          toRowIndex: 0,
          topPx: (SPACING + DOCUMENT_TITLE_HEIGHT) * scale,
          heightPx: SPACING * scale,
        },
        {
          toRowIndex: 1,
          topPx: (SPACING + DOCUMENT_TITLE_HEIGHT + SPACING + 100) * scale,
          heightPx: SPACING * scale,
        },
        {
          toRowIndex: 2,
          topPx: (SPACING + DOCUMENT_TITLE_HEIGHT + SPACING + 100 + SPACING + 80) * scale,
          heightPx: SPACING * scale,
        },
      ]);
    },
  );

  it("keeps a between-row target in paged canvas coordinates", () => {
    const pagedPlacements: ComponentFragmentPlacement[] = [
      {
        fragmentId: "first::0",
        componentId: "first",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 0,
        rect: { x: 0, y: 600, width: 100, height: 100 },
      },
      {
        fragmentId: "second::0",
        componentId: "second",
        fragmentIndex: 0,
        kind: "whole",
        pageIndex: 1,
        rect: { x: 0, y: 0, width: 100, height: 80 },
      },
    ];

    const middle = rowDropZoneGeometry(rows, pagedPlacements, 1)[1];

    expect(middle).toEqual({
      toRowIndex: 1,
      topPx: SPACING + 600 + 100,
      heightPx: pageTopPx(1, 1) + SPACING - (SPACING + 600 + 100),
    });
  });
});
