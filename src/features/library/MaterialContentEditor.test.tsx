// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MaterialContentSaveError, type MaterialDetail } from "../../domain/library";
import type { MaterialContentEditorRepository } from "../../domain/library/ports";
import { MaterialContentEditor } from "./MaterialContentEditor";
import { MaterialEditLease } from "./materialEditLease";

function setup(creating = false) {
  const material: MaterialDetail = {
    id: "material-model", kind: "modelCard", revision: 2, metadataVersion: 4,
    name: "模特素材", description: "原素材说明", tags: ["人像"], favorite: false,
    createdAt: 1, updatedAt: 1, deletedAt: null, imageCount: 0, byteLength: 0,
    previewState: "pending", images: [],
    payload: { format: "preshot-material", version: 1, kind: "modelCard",
      component: { kind: "modelCard", modelId: "原模特", heightCm: 170,
        weightKg: 50, shoeSize: "38", samples: { images: [] } } },
  };
  if (creating) Object.assign(material, {
    revision: 0, metadataVersion: 0, name: "", description: "", tags: [], favorite: false,
  });
  let current = structuredClone(material);
  const commitEdit = vi.fn<MaterialContentEditorRepository["commitEdit"]>(async (input) => {
    current = {
      ...current, payload: input.payload, revision: current.revision + 1,
      ...(input.metadataUpdate ? { ...input.metadataUpdate.metadata, metadataVersion: current.metadataVersion + 1 } : {}),
    };
    return structuredClone(current);
  });
  const repository: MaterialContentEditorRepository = {
    beginCreate: vi.fn(),
    beginEdit: vi.fn(async () => ({ sessionId: `draft-${current.revision}`, material: structuredClone(current) })),
    loadEditImage: vi.fn(), importEditImages: vi.fn(),
    captureEditImage: vi.fn(), cropEditImage: vi.fn(), commitEdit,
    discardEdit: vi.fn(async () => undefined),
  };
  const lease = new MaterialEditLease(repository, { sessionId: "material-draft", material, ...(creating ? { isNew: true } : {}) });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const checkDuplicateName = vi.fn<(name: string, excludeId?: string) => Promise<boolean>>(async () => false);
  function Harness() {
    const [editing, setEditing] = useState(lease);
    return <MaterialContentEditor lease={editing} onSaved={onSaved} onClose={onClose}
      checkDuplicateName={checkDuplicateName}
      onContinue={async (saved) => {
        const next = new MaterialEditLease(repository, await repository.beginEdit(saved.id, saved.revision));
        setEditing(next);
        return next;
      }} />;
  }
  const { unmount } = render(<Harness />);
  return { material, repository, commitEdit, lease, onSaved, onClose, checkDuplicateName, unmount, user: userEvent.setup() };
}

describe("MaterialContentEditor", () => {
  it("closes a new material after its first confirmed save and draft cleanup", async () => {
    const { user, repository, commitEdit, onClose, onSaved, checkDuplicateName } = setup(true);
    await screen.findByDisplayValue("原模特");
    expect(screen.getByRole("dialog", { name: "创建素材" })).toBeVisible();
    expect(commitEdit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    const name = screen.getByRole("textbox", { name: "素材名称" });
    expect(name).toHaveFocus();
    expect(checkDuplicateName).not.toHaveBeenCalled();
    await user.type(name, "新建模特");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "material-model", revision: 1 })));
    expect(repository.discardEdit).toHaveBeenCalledExactlyOnceWith("material-draft");
    expect(repository.beginEdit).not.toHaveBeenCalled();
    expect(checkDuplicateName).toHaveBeenLastCalledWith("新建模特", undefined);
    expect(commitEdit.mock.calls[0][0].metadataUpdate?.expectedVersion).toBe(0);
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ id: "material-model", revision: 1, metadataVersion: 1 }));
    expect(commitEdit).toHaveBeenCalledOnce();
  });

  it("retains a saved creation on cleanup failure and retries close without another save", async () => {
    const { user, repository, commitEdit, onClose } = setup(true);
    vi.mocked(repository.discardEdit).mockRejectedValueOnce(new Error("草稿清理暂时失败"));
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "新建模特");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿清理暂时失败");
    expect(onClose).not.toHaveBeenCalled();
    expect(repository.beginEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存素材" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(repository.discardEdit).toHaveBeenCalledTimes(2);
    expect(commitEdit).toHaveBeenCalledOnce();
  });

  it("cancels an untouched creation draft without publishing any material", async () => {
    const { user, repository, commitEdit, onClose } = setup(true);
    await screen.findByDisplayValue("原模特");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(repository.discardEdit).toHaveBeenCalledExactlyOnceWith("material-draft"));
    expect(onClose).toHaveBeenCalledExactlyOnceWith(null);
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it.each([true, false])("confirms duplicate names with a frozen save and cancellable fields (creating: %s)", async (creating) => {
    const { user, checkDuplicateName, commitEdit, onSaved } = setup(creating);
    checkDuplicateName.mockResolvedValue(true);
    const canvasName = await screen.findByDisplayValue("原模特");
    const name = screen.getByRole("textbox", { name: "素材名称" });
    fireEvent.change(name, { target: { value: "同名素材" } });
    fireEvent.change(canvasName, { target: { value: "确认的文字" } });
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await screen.findByRole("dialog", { name: "保存同名素材？" });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    expect(commitEdit).not.toHaveBeenCalled();
    expect(screen.getByText(creating ? "确认后将新增一份独立素材，不会覆盖已有素材。" :
      "确认后只更新当前素材，不会覆盖其他同名素材。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(name).toHaveValue("同名素材");
    expect(canvasName).toHaveValue("确认的文字");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await screen.findByRole("dialog", { name: "保存同名素材？" });
    fireEvent.change(name, { target: { value: "提示后发生的改动" } });
    fireEvent.change(canvasName, { target: { value: "提示后改变的文字" } });
    await user.dblClick(screen.getByRole("button", { name: "仍然保存" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(checkDuplicateName).toHaveBeenCalledTimes(2);
    expect(checkDuplicateName).toHaveBeenLastCalledWith("同名素材", creating ? undefined : "material-model");
    expect(commitEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      metadataUpdate: { expectedVersion: creating ? 0 : 4, metadata: expect.objectContaining({ name: "同名素材" }) },
      payload: expect.objectContaining({ component: expect.objectContaining({ modelId: "确认的文字" }) }),
    }));
  });

  it("blocks a failed duplicate lookup and retries the lookup without losing input", async () => {
    const { user, checkDuplicateName, commitEdit, onSaved } = setup(true);
    checkDuplicateName.mockRejectedValueOnce(new Error("检索暂时失败"));
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "待保存素材");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("检索暂时失败");
    expect(commitEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "素材名称" })).toHaveValue("待保存素材");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(checkDuplicateName).toHaveBeenCalledTimes(2);
  });

  it("does not save after a late lookup resolves for a retired editor", async () => {
    const { user, checkDuplicateName, commitEdit, unmount, lease } = setup(true);
    let finish!: (duplicate: boolean) => void;
    checkDuplicateName.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "已关闭草稿");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(screen.getByRole("textbox", { name: "素材名称" })).toBeDisabled();
    unmount();
    await lease.retire();
    finish(false);
    await Promise.resolve();
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it("retries an unknown first creation exactly without another name lookup or record", async () => {
    const { user, checkDuplicateName, commitEdit, onSaved } = setup(true);
    const commit = commitEdit.getMockImplementation()!;
    let receipt!: MaterialDetail;
    commitEdit.mockImplementationOnce(async (input) => {
      receipt = await commit(input);
      throw new Error("保存响应中断");
    }).mockImplementationOnce(async () => receipt);
    checkDuplicateName.mockResolvedValue(true);
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "同名新素材");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await user.click(await screen.findByRole("button", { name: "仍然保存" }));
    await user.click(await screen.findByRole("button", { name: "重试确认保存" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(checkDuplicateName).toHaveBeenCalledOnce();
    expect(commitEdit.mock.calls[1][0]).toEqual(commitEdit.mock.calls[0][0]);
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ id: "material-model", revision: 1, metadataVersion: 1 }));
  });

  it.each([true, false])("saves the canvas and pinned metadata together (metadata changed: %s)", async (changeMetadata) => {
    const { material, commitEdit, user, onClose, onSaved } = setup();
    const modelName = await screen.findByDisplayValue("原模特");
    await user.clear(modelName);
    await user.type(modelName, "新模特");
    if (changeMetadata) {
      const name = screen.getByRole("textbox", { name: "素材名称" });
      await user.clear(name);
      await user.type(name, "新的素材名称");
      fireEvent.change(screen.getByRole("textbox", { name: "标签" }), { target: { value: " 新标签，第二标签 " } });
      fireEvent.change(screen.getByRole("textbox", { name: "素材说明" }), { target: { value: "新的素材说明" } });
      await user.click(screen.getByRole("checkbox", { name: "收藏素材" }));
    }
    await user.dblClick(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "素材名称" })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "编辑素材" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存素材" })).toBeDisabled();
    expect(commitEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      payload: expect.objectContaining({ component: expect.objectContaining({ modelId: "新模特" }) }),
      metadataUpdate: { expectedVersion: 4, metadata: changeMetadata ? {
        name: "新的素材名称", description: "新的素材说明", tags: ["新标签", "第二标签"], favorite: true,
      } : { name: material.name, description: material.description, tags: material.tags, favorite: false } },
    }));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(material.payload.component).toMatchObject({ modelId: "原模特" });
    expect(material.name).toBe("模特素材");
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ revision: 3 })));
  });

  it("continues editing and saves again with fresh versions and an independent operation", async () => {
    const { user, commitEdit, repository, onClose, onSaved } = setup();
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "第一次");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(repository.beginEdit).toHaveBeenCalledExactlyOnceWith("material-model", 3));
    const field = await screen.findByDisplayValue("原模特");
    await waitFor(() => expect(field).toBeEnabled());
    await user.type(field, "第二次");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(commitEdit.mock.calls[1][0]).toMatchObject({
      sessionId: "draft-3", metadataUpdate: { expectedVersion: 5 },
      payload: { component: { modelId: "原模特第二次" } },
    });
    expect(commitEdit.mock.calls[1][0].operationId).not.toBe(commitEdit.mock.calls[0][0].operationId);
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ revision: 4, metadataVersion: 6 })));
  });

  it("discards only unsaved changes made after a successful save", async () => {
    const { user, commitEdit, onClose, repository } = setup();
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "已保存");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(repository.beginEdit).toHaveBeenCalledOnce());
    const name = screen.getByRole("textbox", { name: "素材名称" });
    await waitFor(() => expect(name).toBeEnabled());
    await user.type(name, "未保存");
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("dialog", { name: "放弃素材修改？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ name: "模特素材已保存", revision: 3 })));
    expect(commitEdit).toHaveBeenCalledOnce();
  });

  it.each(["begin", "discard"])("retries %s after saving without repeating the canonical commit", async (stage) => {
    const { user, repository, commitEdit, onClose } = setup();
    if (stage === "begin") vi.mocked(repository.beginEdit).mockRejectedValueOnce(new Error("无法打开后续草稿"));
    else vi.mocked(repository.discardEdit).mockRejectedValueOnce(new Error("无法清理旧草稿"));
    await screen.findByDisplayValue("原模特");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "修改");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("素材已保存");
    expect(screen.getByRole("textbox", { name: "素材名称" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "重试继续编辑" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "素材名称" })).toBeEnabled());
    expect(commitEdit).toHaveBeenCalledOnce();
    expect(repository.beginEdit).toHaveBeenCalledTimes(stage === "begin" ? 2 : 1);
    expect(onClose).not.toHaveBeenCalled();
  });
  it("discards metadata and canvas edits together without saving", async () => {
    const { commitEdit, repository, onClose, user } = setup();
    const modelName = await screen.findByDisplayValue("原模特");
    await user.type(modelName, "修改");
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "修改");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("dialog", { name: "放弃素材修改？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(modelName).toHaveValue("原模特修改");
    expect(screen.getByRole("textbox", { name: "素材名称" })).toHaveValue("模特素材修改");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(repository.discardEdit).toHaveBeenCalledExactlyOnceWith("material-draft");
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it("focuses invalid metadata before any save and ignores Ctrl+S during composition", async () => {
    const { commitEdit, user } = setup();
    await screen.findByDisplayValue("原模特");
    const name = screen.getByRole("textbox", { name: "素材名称" });
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("名称");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(commitEdit).not.toHaveBeenCalled();
    fireEvent.compositionStart(name);
    fireEvent.change(name, { target: { value: "新素材" } });
    fireEvent.keyDown(name, { key: "s", ctrlKey: true });
    expect(commitEdit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(name);
    fireEvent.keyDown(name, { key: "s", ctrlKey: true });
    await waitFor(() => expect(commitEdit).toHaveBeenCalledOnce());
  });

  it("freezes both surfaces and retries the same combined save after an unknown response", async () => {
    const { commitEdit, user, onSaved } = setup();
    commitEdit.mockRejectedValueOnce(new MaterialContentSaveError("连接中断，保存结果未知", "unknown"));
    const modelName = await screen.findByDisplayValue("原模特");
    await user.type(modelName, "修改");
    const name = screen.getByRole("textbox", { name: "素材名称" });
    await user.type(name, "修改");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    const retry = await screen.findByRole("button", { name: "重试确认保存" });
    expect(name).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "标签" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "收藏素材" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(retry);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(commitEdit).toHaveBeenCalledTimes(2);
    expect(commitEdit.mock.calls[1][0]).toBe(commitEdit.mock.calls[0][0]);
    expect(commitEdit.mock.calls[1][0].metadataUpdate?.metadata.name).toBe("模特素材修改");
  });
});
