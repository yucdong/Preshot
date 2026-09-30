import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";

describe("NewProjectDialog", () => {
  it.each(["项目名称", "项目所在路径"])("keeps %s IME composition from submitting or closing the dialog", async (label) => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(<NewProjectDialog defaultParentPath={"C:\\Preshot"} onPickDirectory={vi.fn()} onCreate={onCreate} onClose={onClose} />);
    const name = screen.getByLabelText("项目名称");
    fireEvent.change(name, { target: { value: "南京" } });
    const field = screen.getByLabelText(label);
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    fireEvent.submit(field.closest("form")!);
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledExactlyOnceWith("南京", "C:\\Preshot"));
  });

  it("shows both fields and creates beneath the entered parent with the trimmed name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onPickDirectory = vi.fn();
    render(<NewProjectDialog defaultParentPath={"C:\\Users\\me\\.preshot\\projects"} onPickDirectory={onPickDirectory} onCreate={onCreate} onClose={vi.fn()} />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const path = screen.getByLabelText("项目所在路径");
    expect(path).toHaveValue("C:\\Users\\me\\.preshot\\projects");
    expect(path).toHaveAccessibleDescription("这里是项目文件夹的上级目录。创建时会在此目录下新建一个以项目名称命名的文件夹。");
    expect(screen.getByLabelText("项目名称")).toHaveFocus();
    expect(onPickDirectory).not.toHaveBeenCalled();
    await user.clear(path);
    await user.type(path, "  D:\\拍摄项目  ");
    await user.type(screen.getByLabelText("项目名称"), "  棚拍计划  ");
    expect(screen.getByText("将创建：D:\\拍摄项目\\棚拍计划")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledExactlyOnceWith("棚拍计划", "D:\\拍摄项目");
  });

  it("starts the directory picker at the current path and keeps both inputs on cancellation or failure", async () => {
    const user = userEvent.setup();
    const onPickDirectory = vi.fn().mockResolvedValueOnce("D:\\拍摄项目").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("目录无法访问"));
    const onCreate = vi.fn().mockRejectedValue(new Error("项目已存在"));
    const onClose = vi.fn();
    render(<NewProjectDialog defaultParentPath={"C:\\Preshot"} onPickDirectory={onPickDirectory} onCreate={onCreate} onClose={onClose} />);
    await user.type(screen.getByLabelText("项目名称"), "棚拍");
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(onPickDirectory).toHaveBeenLastCalledWith("C:\\Preshot");
    expect(screen.getByLabelText("项目所在路径")).toHaveValue("D:\\拍摄项目");
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(onPickDirectory).toHaveBeenLastCalledWith("D:\\拍摄项目");
    expect(screen.getByLabelText("项目所在路径")).toHaveValue("D:\\拍摄项目");
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(screen.getByRole("alert")).toHaveTextContent("目录无法访问");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(screen.getByRole("alert")).toHaveTextContent("项目已存在");
    expect(screen.getByLabelText("项目名称")).toHaveValue("棚拍");
    expect(onClose).not.toHaveBeenCalled();
  });
});
