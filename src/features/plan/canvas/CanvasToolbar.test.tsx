import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasToolbar } from "./CanvasToolbar";

describe("CanvasToolbar", () => {
  it("renders the canvas actions without undo, redo, or settings and keeps export last", () => {
    render(
      <CanvasToolbar
        disabled={false}
        exporting={false}
        onExport={vi.fn()}
        onInsert={vi.fn()}
        saveState="saved"
      />,
    );

    expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重做" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveTextContent("导出 PDF");
    expect(buttons[buttons.length - 1]).toHaveClass("bg-app-accent");
  });
});
