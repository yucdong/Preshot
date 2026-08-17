import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BlockNoteCanvasToolbar } from "./BlockNoteCanvasToolbar";

describe("BlockNoteCanvasToolbar", () => {
  it("renders status and delegates zoom and export actions", async () => {
    const user = userEvent.setup();
    const handlers = {
      onExport: vi.fn(),
      onFitWidth: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    };
    render(
      <BlockNoteCanvasToolbar
        exporting={false}
        saveState="saved"
        zoom={0.85}
        {...handlers}
      />,
    );

    expect(screen.getByText("BlockNote Canvas v14")).toBeVisible();
    expect(screen.getByRole("button", { name: "恢复 100% 缩放" }))
      .toHaveTextContent("85%");
    await user.click(screen.getByRole("button", { name: "缩小画布" }));
    await user.click(screen.getByRole("button", { name: "放大画布" }));
    await user.click(screen.getByRole("button", { name: "恢复 100% 缩放" }));
    await user.click(screen.getByRole("button", { name: "适合宽度" }));
    await user.click(screen.getByRole("button", { name: "导出 PDF" }));

    expect(handlers.onZoomOut).toHaveBeenCalledOnce();
    expect(handlers.onZoomIn).toHaveBeenCalledOnce();
    expect(handlers.onResetZoom).toHaveBeenCalledOnce();
    expect(handlers.onFitWidth).toHaveBeenCalledOnce();
    expect(handlers.onExport).toHaveBeenCalledOnce();
  });

  it("presents the exporting state and disables duplicate export", () => {
    render(
      <BlockNoteCanvasToolbar
        exporting
        onExport={vi.fn()}
        onFitWidth={vi.fn()}
        onResetZoom={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        saveState="saving"
        zoom={1}
      />,
    );

    expect(screen.getByRole("button", { name: "导出中…" })).toBeDisabled();
    expect(screen.getByTestId("save-status")).toBeVisible();
  });
});
