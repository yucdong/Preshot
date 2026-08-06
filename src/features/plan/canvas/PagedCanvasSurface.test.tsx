import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { A4 } from "../../../domain/plan/canvas/geometry";
import { PagedCanvasSurface } from "./PagedCanvasSurface";
import { PAGE_SCREEN_GAP, pageTopPx } from "./pagedCanvasMetrics";

const droppableState = vi.hoisted(() => ({
  options: [] as Array<{ id: string | number; data?: { type?: string } }>,
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: (options: { id: string | number; data?: { type?: string } }) => {
    droppableState.options.push(options);
    return { setNodeRef: vi.fn() };
  },
}));

describe("PagedCanvasSurface", () => {
  beforeEach(() => {
    droppableState.options = [];
  });

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

  it("registers one canvas droppable for the entire continuous surface", () => {
    render(
      <PagedCanvasSurface pageCount={3} scale={1}>
        <div />
      </PagedCanvasSurface>,
    );

    expect(droppableState.options).toHaveLength(1);
    expect(droppableState.options[0]).toMatchObject({
      data: { type: "canvas" },
    });
    expect(typeof droppableState.options[0].id).toBe("number");
  });
});
