import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { A4 } from "../../../domain/plan/canvas/geometry";
import { PAGE_SCREEN_GAP, PagedCanvasSurface, pageTopPx } from "./PagedCanvasSurface";

describe("PagedCanvasSurface", () => {
  it("renders A4 sheet backgrounds in one continuous positioning surface", () => {
    render(
      <PagedCanvasSurface pageCount={2} scale={1}>
        <div />
      </PagedCanvasSurface>,
    );

    expect(screen.getAllByTestId("canvas-page-background")).toHaveLength(2);
    expect(screen.getByTestId("paged-canvas-surface")).toHaveStyle({
      height: `${A4.height * 2 + PAGE_SCREEN_GAP}px`,
    });
  });

  it("maps later pages into the shared global Y axis", () => {
    expect(pageTopPx(0, 1)).toBe(0);
    expect(pageTopPx(1, 1)).toBe(A4.height + PAGE_SCREEN_GAP);
  });
});
