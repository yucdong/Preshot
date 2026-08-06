import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RowDropZone } from "./RowDropZone";

const useDroppable = vi.hoisted(() => vi.fn(() => ({ setNodeRef: () => undefined })));

vi.mock("@dnd-kit/core", () => ({
  useDroppable,
}));

describe("RowDropZone", () => {
  it("registers a row-gap target before its logical row", () => {
    render(<RowDropZone beforeRowId="row-b" topPx={80} />);

    expect(useDroppable).toHaveBeenCalledWith({
      id: "row-gap:row-b",
      data: { type: "row-gap", beforeRowId: "row-b" },
    });
    expect(screen.getByTestId("row-drop-zone:row-b")).toHaveStyle({ top: "80px" });
  });
});
