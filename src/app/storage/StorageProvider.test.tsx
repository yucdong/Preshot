import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StorageInfo, StorageRepository } from "../../domain/storage/ports";
import { StorageProvider } from "./StorageProvider";
import { StorageSettings } from "../../features/settings/StorageSettings";

const initial: StorageInfo = { configurationDirectory: "C:\\Users\\test\\.preshot", applicationDirectory: "C:\\Program Files\\Preshot",
  libraryDirectory: "D:\\library", existingWorkingDirectory: null, generation: 0, needsSetup: true, pendingMove: false, problem: null };
function repo(info = initial): StorageRepository {
  return { status: vi.fn().mockResolvedValue(info), configure: vi.fn().mockResolvedValue({ ...info, needsSetup: false }),
    move: vi.fn(), cancelMove: vi.fn(), pickDirectory: vi.fn().mockResolvedValue(null), reveal: vi.fn() };
}
describe("persistent storage setup", () => {
  it("does not initialize storage until the working path IME composition is committed", async () => {
    const repository = repo();
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    const input = await screen.findByRole("textbox", { name: "项目工作路径" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "D:\\摄影" } });
    fireEvent.submit(input.closest("form")!);
    expect(repository.configure).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(repository.configure).toHaveBeenCalledExactlyOnceWith("D:\\摄影"));
  });

  it("waits for a valid storage configuration before mounting the workspace", async () => {
    const repository = repo();
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    expect(screen.queryByText("工作区已打开")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "使用此目录并继续" }));
    expect(repository.configure).toHaveBeenCalledWith("C:\\Users\\test\\.preshot");
    expect(await screen.findByText("工作区已打开")).toBeVisible();
  });
  it("only asks for a working directory on first launch", async () => {
    render(<StorageProvider repository={repo()}><p>工作区已打开</p></StorageProvider>);
    expect(await screen.findByRole("textbox", { name: "项目工作路径" })).toHaveValue(initial.configurationDirectory);
    expect(screen.queryByText("程序安装目录")).toBeNull();
    expect(screen.queryByText("当前素材库目录")).toBeNull();
    expect(screen.queryByText(initial.libraryDirectory)).toBeNull();
  });
  it("offers to keep a detected directory without opening a folder picker", async () => {
    const repository = repo({ ...initial, existingWorkingDirectory: initial.configurationDirectory });
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    expect(await screen.findByText("检测到已有项目工作路径，是否切换？")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "继续使用已有路径" }));
    expect(repository.configure).toHaveBeenCalledWith(initial.configurationDirectory);
    expect(repository.pickDirectory).not.toHaveBeenCalled();
    expect(await screen.findByText("工作区已打开")).toBeVisible();
  });
  it("confirms switching and preserves the entered path when cancelled or failed", async () => {
    const repository = repo({ ...initial, existingWorkingDirectory: initial.configurationDirectory });
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "切换项目工作路径" }));
    const input = screen.getByRole("textbox", { name: "项目工作路径" });
    await userEvent.clear(input);
    await userEvent.type(input, "D:\\摄影工作目录");
    await userEvent.click(screen.getByRole("button", { name: "使用此目录并继续" }));
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("原路径中的素材库、设置和项目列表不会自动带入新路径");
    expect(confirmation).toHaveTextContent("旧文件不会被删除");
    expect(confirmation).toHaveTextContent(initial.configurationDirectory);
    expect(repository.configure).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("D:\\摄影工作目录");
    expect(input).toHaveFocus();
    vi.mocked(repository.configure).mockRejectedValueOnce(new Error("Access denied"));
    await userEvent.click(screen.getByRole("button", { name: "使用此目录并继续" }));
    await userEvent.click(screen.getByRole("button", { name: "确认切换并继续" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
    expect(repository.configure).toHaveBeenCalledWith("D:\\摄影工作目录", true);
    expect(screen.queryByText("工作区已打开")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(input).toHaveValue("D:\\摄影工作目录");
  });
  it("shows recovery without silently creating a library on a missing drive", async () => {
    const repository = repo({ ...initial, needsSetup: false, problem: "Drive missing" });
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Drive missing");
    expect(screen.queryByText("工作区已打开")).toBeNull();
    expect(repository.configure).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "将素材库迁移到此目录" })).toBeNull();
  });
  it("keeps the path when folder picking is cancelled", async () => {
    const repository = repo();
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    const input = await screen.findByRole("textbox", { name: "项目工作路径" });
    await userEvent.click(screen.getByRole("button", { name: "选择目录" }));
    expect(repository.pickDirectory).toHaveBeenCalledWith(initial.configurationDirectory);
    expect(input).toHaveValue(initial.configurationDirectory);
    expect(repository.configure).not.toHaveBeenCalled();
  });
  it("blocks repeated submissions and recovers a committed setup after a lost response", async () => {
    const repository = repo();
    let reject!: (error: Error) => void;
    vi.mocked(repository.configure).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<StorageProvider repository={repository}><p>工作区已打开</p></StorageProvider>);
    const submit = await screen.findByRole("button", { name: "使用此目录并继续" });
    await userEvent.dblClick(submit);
    expect(repository.configure).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    vi.mocked(repository.status).mockResolvedValue({ ...initial, needsSetup: false });
    reject(new Error("Response lost"));
    expect(await screen.findByText("工作区已打开")).toBeVisible();
    expect(repository.configure).toHaveBeenCalledTimes(1);
  });
  it("keeps locations read-only once the data directory is chosen", async () => {
    const repository = repo({ ...initial, needsSetup: false });
    render(<StorageProvider repository={repository}><input aria-label="未保存的项目内容" defaultValue="保留编辑" /><StorageSettings /></StorageProvider>);
    const editor = await screen.findByRole("textbox", { name: "未保存的项目内容" });
    expect(screen.queryByRole("textbox", { name: "项目工作路径" })).toBeNull();
    expect(screen.queryByRole("button", { name: "将素材库迁移到此目录" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "重新检查" }));
    await waitFor(() => expect(repository.status).toHaveBeenCalledTimes(2));
    expect(editor).toHaveValue("保留编辑");
  });
});
