import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import i18n from "../../shared/i18n/config";
import { applyOrganizationCommand, emptyOrganization, type ProjectOrganizationCommand } from "../../domain/workspace/organization";
import type { ProjectOrganization, WorkspaceProjectView } from "../../domain/workspace/models";
import { ProjectGroups } from "./ProjectGroups";

const projects: WorkspaceProjectView[] = ["南京大桥夜景", "Autumn Portrait", "南京旧项目"].map((name, index) => ({
  projectId: `p${index}`, name, path: `C:/${index}`, status: index === 2 ? "unavailable" : "available", coverImage: null, coverDataUrl: null,
  createdAt: "2026-09-01", updatedAt: `2026-09-0${3 - index}`, lastOpenedAt: "2026-09-01",
}));
const initial: ProjectOrganization = { ...emptyOrganization(), groups: [...emptyOrganization().groups, { id: "portraits", name: "人像", collapsed: true }], projectGroupIds: { p1: "portraits" } };

function setup(options: { fail?: boolean; moving?: boolean } = {}) {
  const committed = vi.fn();
  let shouldFail = options.fail;
  function Harness() {
    const [organization, setOrganization] = useState(initial);
    const [query, setQuery] = useState("");
    const [moving, setMoving] = useState(options.moving ? projects[0] : null);
    return <ProjectGroups projects={projects} organization={organization} query={query} onQueryChange={setQuery} currentProjectId="p0"
      onSelectProject={vi.fn()} menuProjectId={null} onProjectMenu={vi.fn()} registerMenuTrigger={() => {}}
      moveProject={moving} onMoveDialogClose={() => setMoving(null)}
      onChange={async (command: ProjectOrganizationCommand) => {
        if (shouldFail) { shouldFail = false; throw new Error("磁盘已满"); }
        const next = applyOrganizationCommand(organization, projects.map(p => p.projectId), command);
        committed(command); setOrganization(next);
      }} />;
  }
  render(<Harness />);
  return { user: userEvent.setup(), committed };
}

describe("grouped project sidebar", () => {
  it("shows a direct create/delete button and localizes only the built-in group", async () => {
    const { user, committed } = setup();
    expect(screen.getByRole("button", { name: "默认分组" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "删除分组 默认分组" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除分组 人像" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "新建分组" }));
    await user.type(screen.getByRole("textbox", { name: "分组名称" }), "旅行");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "创建" }));
    expect(await screen.findByRole("button", { name: "旅行" })).toBeVisible();
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ type: "create", name: "旅行" }));
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(screen.getByRole("button", { name: "Default" })).toBeVisible();
    expect(screen.getByRole("button", { name: "旅行" })).toBeVisible();
  });

  it("finds projects across collapsed groups, handles IME and restores collapse after clearing", async () => {
    const { user, committed } = setup();
    expect(screen.queryByRole("button", { name: "打开项目 Autumn Portrait" })).not.toBeInTheDocument();
    const input = screen.getByRole("searchbox", { name: "搜索项目名称" });
    await user.type(input, "PORTRAIT");
    expect(screen.getByRole("button", { name: "打开项目 Autumn Portrait" })).toBeVisible();
    expect(screen.getByText("Portrait", { selector: "mark" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(screen.queryByRole("button", { name: "打开项目 Autumn Portrait" })).not.toBeInTheDocument();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "nan" } });
    expect(screen.getByRole("button", { name: "打开项目 南京大桥夜景" })).toBeVisible();
    fireEvent.compositionEnd(input, { data: "南京", target: { value: "南京" } });
    expect(screen.getByRole("button", { name: "南京旧项目（不可用）" })).toBeVisible();
    expect(committed).not.toHaveBeenCalled();
    await user.clear(input); await user.type(input, "not found");
    expect(screen.getByText("没有匹配的项目")).toBeVisible();
  });

  it("keeps a failed deletion retryable and moves members to default on confirmed save", async () => {
    const { user, committed } = setup({ fail: true });
    await user.click(screen.getByRole("button", { name: "删除分组 人像" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("1 个项目将移至“默认分组”");
    const remove = within(screen.getByRole("dialog")).getByRole("button", { name: "删除分组" });
    await user.click(remove);
    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘已满");
    expect(committed).not.toHaveBeenCalled();
    await user.click(remove);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "打开项目 Autumn Portrait" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "人像" })).not.toBeInTheDocument();
  });

  it("supports moving without dragging and expands the destination", async () => {
    const { user, committed } = setup({ moving: true });
    await user.selectOptions(screen.getByLabelText("目标分组"), "portraits");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移动" }));
    expect(committed).toHaveBeenCalledWith({ type: "move", projectId: "p0", groupId: "portraits" });
    expect(screen.getByRole("button", { name: "人像" })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps IME confirmation inside the name field and traps keyboard focus", async () => {
    const { user, committed } = setup();
    const create = screen.getByRole("button", { name: "新建分组" });
    await user.click(create);
    const input = screen.getByRole("textbox", { name: "分组名称" });
    expect(input).toHaveFocus();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "旅行" } });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(committed).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: "旅行" });
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "创建" })).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(create).toHaveFocus());
    expect(committed).not.toHaveBeenCalled();
  });

  it("keeps invalid names editable and supports renaming from the keyboard menu", async () => {
    const { user, committed } = setup();
    await user.click(screen.getByRole("button", { name: "分组操作 人像" }));
    const rename = await screen.findByRole("menuitem", { name: "重命名" });
    await waitFor(() => expect(rename).toHaveFocus());
    await user.keyboard("{Enter}");
    const input = screen.getByRole("textbox", { name: "分组名称" });
    await user.clear(input);
    await user.type(input, "Default{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("已存在");
    expect(committed).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, " 秋日人像 {Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "秋日人像" })).toHaveAttribute("aria-expanded", "false");
  });
});
