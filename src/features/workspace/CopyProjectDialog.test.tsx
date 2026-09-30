// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyProjectDialog } from "./CopyProjectDialog";

afterEach(cleanup);
const props = () => ({ sourceName: "南京长江大桥", sourcePath: "C:\\拍摄\\南京长江大桥", sourceProjectId: "source", defaultParentPath: "C:\\拍摄", defaultName: "南京长江大桥 - 副本",
  onClose: vi.fn(), onPickDirectory: vi.fn().mockResolvedValue(null), onCopy: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue(null), cancelCopy: vi.fn().mockResolvedValue(undefined), acknowledge: vi.fn().mockResolvedValue(undefined) });
describe("copy project dialog", () => {
  it("does not copy or close while the project name is being composed", async () => {
    const input = props();
    render(<CopyProjectDialog {...input} />);
    const name = screen.getByRole("textbox", { name: "新项目名称" });
    fireEvent.compositionStart(name);
    fireEvent.keyDown(name, { key: "Escape" });
    fireEvent.submit(name.closest("form")!);
    expect(input.onClose).not.toHaveBeenCalled();
    expect(input.onCopy).not.toHaveBeenCalled();
    fireEvent.compositionEnd(name);
    fireEvent.submit(name.closest("form")!);
    await waitFor(() => expect(input.onCopy).toHaveBeenCalledOnce());
  });

  it("explains the parent path, previews the destination and preserves inputs after failure", async () => {
    const input = props(); input.onCopy.mockRejectedValue(new Error("磁盘空间不足"));
    render(<CopyProjectDialog {...input} />);
    expect(screen.getByText(/上级目录/)).toBeVisible();
    expect(screen.getByText(/C:\\拍摄\\南京长江大桥 - 副本/)).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "新项目名称" }), { target: { value: "第二次拍摄" } });
    fireEvent.click(screen.getByRole("button", { name: "复制项目" }));
    await screen.findByText("磁盘空间不足");
    expect(screen.getByRole("textbox", { name: "新项目名称" })).toHaveValue("第二次拍摄");
    expect(input.onClose).not.toHaveBeenCalled();
  });
  it("blocks duplicate submission and cancels the same operation", async () => {
    const input = props(); let reject!: (error: Error) => void;
    input.onCopy.mockImplementation(() => new Promise((_, no) => { reject = no; }));
    render(<CopyProjectDialog {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "复制项目" }));
    expect(screen.getByRole("textbox", { name: "新项目名称" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消复制" }));
    await waitFor(() => expect(input.cancelCopy).toHaveBeenCalledWith(input.onCopy.mock.calls[0][0].operationId));
    expect(input.onCopy).toHaveBeenCalledTimes(1);
    reject(new Error("cancelled"));
    await screen.findByText("复制已取消。原项目已完成的保存不会回滚。");
  });
});
