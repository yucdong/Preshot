import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloseProjectDialog } from "./CloseProjectDialog";

describe("CloseProjectDialog", () => {
  it("names the project, traps focus and offers save, discard and cancellation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(<CloseProjectDialog projectName="棚拍" busy={false} error={null} onClose={onClose} onCancel={onCancel} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("关闭“棚拍”前是否保存？");
    expect(screen.getByRole("button", { name: "保存并关闭" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));
    expect(onClose).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "不保存并关闭" }));
    expect(onClose).toHaveBeenLastCalledWith(false);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks repeated actions while saving and exposes retry after failure", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const props = { projectName: "棚拍", onClose, onCancel };
    const view = render(<CloseProjectDialog {...props} busy={false} error={null} />);
    view.rerender(<CloseProjectDialog {...props} busy error={null} />);
    screen.getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    view.rerender(<CloseProjectDialog {...props} busy={false} error="磁盘空间不足" />);
    expect(screen.getByRole("alert")).toHaveTextContent("磁盘空间不足");
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
