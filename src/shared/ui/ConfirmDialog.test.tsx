import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { DialogPortalContext } from "./DialogPortalContext";

describe("ConfirmDialog", () => {
  it("uses the enclosing modal portal host and consumes nested Escape", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const outerEscape = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(
      <div onKeyDown={outerEscape}>
        <DialogPortalContext.Provider value={() => host}>
          <ConfirmDialog open title="删除图片？" confirmLabel="删除" cancelLabel="取消"
            onConfirm={vi.fn()} onCancel={onCancel} />
        </DialogPortalContext.Provider>
      </div>,
    );
    expect(host).toContainElement(screen.getByRole("dialog"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(outerEscape).not.toHaveBeenCalled();
    unmount();
    host.remove();
  });
  it("renders nothing when not open", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="确定删除？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title and both buttons when open", () => {
    render(
      <ConfirmDialog
        open={true}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "确定删除该组件？");
    expect(screen.getByText("确定删除该组件？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when backdrop is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const backdrop = screen.getByRole("dialog").parentElement;
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    }
  });

  it("calls onCancel when Escape key is pressed", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("focuses the confirm button when opened", () => {
    const { rerender } = render(
      <ConfirmDialog
        open={false}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    rerender(
      <ConfirmDialog
        open={true}
        title="确定删除该组件？"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "删除" })).toHaveFocus();
  });
});
