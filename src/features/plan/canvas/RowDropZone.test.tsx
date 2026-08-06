import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RowDropZone } from "./RowDropZone";

const useDroppable = vi.hoisted(() => vi.fn(() => ({ setNodeRef: () => undefined })));

vi.mock("@dnd-kit/core", () => ({
  useDroppable,
}));

describe("RowDropZone", () => {
  it("registers a row-gap target at its post-removal row index", () => {
    render(<RowDropZone toRowIndex={0} topPx={80} />);

    expect(useDroppable).toHaveBeenCalledWith({
      id: "row-gap:0",
      data: { type: "row-gap", toRowIndex: 0 },
    });
    expect(screen.getByTestId("row-drop-zone:0")).toHaveStyle({ top: "80px" });
  });
});
