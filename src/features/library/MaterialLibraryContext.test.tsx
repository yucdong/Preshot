// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterialDetail, MaterialEditSession, MaterialSnapshot } from "../../domain/library/models";
import type { MaterialContentEditorRepository, MaterialLibraryRepository } from "../../domain/library/ports";
import { MaterialContentSaveError } from "../../domain/library";
import {
  useOptionalMaterialLibrary,
  type MaterialLibraryController,
} from "./MaterialLibraryContext";
import { MaterialLibraryProvider } from "./MaterialLibraryProvider";

const material: MaterialDetail = {
  id: "6df83545-5a19-4d47-a305-0b8d58ca448c",
  name: "窗边参考", description: "下午拍摄", tags: ["窗光"], favorite: false,
  kind: "imageGroup", revision: 1, metadataVersion: 3,
  createdAt: 1, updatedAt: 2, deletedAt: null, imageCount: 0,
  byteLength: 0, previewState: "pending", images: [],
  payload: {
    format: "preshot-material", version: 1, kind: "imageGroup",
    component: { kind: "imageGroup", name: "原组件标题", description: "完整参考说明", images: [] },
  },
};
const snapshot: MaterialSnapshot = {
  sourceBlockId: "source", payload: material.payload, sources: [], omittedLegacyImages: 0,
};

function repository(overrides: Partial<MaterialLibraryRepository> = {}): MaterialLibraryRepository {
  return {
    availability: "test",
    search: vi.fn(async () => ({ items: [material], total: 1, indexState: "ready" as const })),
    get: vi.fn(async () => material),
    save: vi.fn(), updateMetadata: vi.fn(), setDeleted: vi.fn(), purge: vi.fn(),
    loadImage: vi.fn(), loadPreview: vi.fn(async () => null),
    savePreview: vi.fn(), markPreviewFailed: vi.fn(),
    prepareInsert: vi.fn(), commitInsert: vi.fn(), abortInsert: vi.fn(), getInsertStatus: vi.fn(),
    ...overrides,
  };
}

function editingRepository(
  read = () => material, write: (value: MaterialDetail) => void = () => undefined,
): MaterialContentEditorRepository {
  return {
    beginCreate: vi.fn(),
    beginEdit: vi.fn(async () => ({ sessionId: `edit-draft-${read().revision}`, material: structuredClone(read()) })),
    loadEditImage: vi.fn(), importEditImages: vi.fn(), captureEditImage: vi.fn(), cropEditImage: vi.fn(),
    discardEdit: vi.fn(async () => undefined),
    commitEdit: vi.fn<MaterialContentEditorRepository["commitEdit"]>(async (input) => {
      const current = read();
      const result = {
        ...current, payload: input.payload, revision: current.revision + 1,
        ...(input.metadataUpdate ? { ...input.metadataUpdate.metadata, metadataVersion: current.metadataVersion + 1 } : {}),
      };
      write(result);
      return result;
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Launcher({
  onSave = async () => material,
  onInsert = async () => undefined,
  source = snapshot,
  capture,
}: {
  onSave?: (metadata: { name: string }) => Promise<MaterialDetail>;
  onInsert?: () => Promise<void>;
  source?: MaterialSnapshot;
  capture?: (controller: MaterialLibraryController) => void;
}) {
  const library = useOptionalMaterialLibrary();
  if (!library) return <p>未提供素材库</p>;
  capture?.(library);
  return <>
    <button onClick={() => library.openBrowser()}>管理素材</button>
    <button onClick={() => library.openBrowser({ targetLabel: "夜景计划 · 文档开头", onInsert })}>从库插入</button>
    <button onClick={() => library.openSave({ snapshot: source, projectName: "夜景计划", onSave })}>保存当前组件</button>
  </>;
}

afterEach(() => { vi.useRealTimers(); });

describe("MaterialLibraryProvider", () => {
  it("keeps existing library consumers connected when the provider module is refreshed", async () => {
    // A timestamped import re-evaluates the provider, as Vite does during HMR,
    // while Launcher retains the hook imported before that refresh.
    const refreshedModule = "./MaterialLibraryProvider.tsx?provider-refresh";
    const { MaterialLibraryProvider: RefreshedProvider } = await import(
      /* @vite-ignore */ refreshedModule
    ) as typeof import("./MaterialLibraryProvider");
    render(<RefreshedProvider repository={repository()}><Launcher /></RefreshedProvider>);

    expect(screen.queryByText("未提供素材库")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "管理素材" }));
    expect(await screen.findByRole("dialog", { name: "素材库" })).toBeVisible();
  });

  it("routes the shared library entry to the current document and ignores obsolete target cleanup", async () => {
    const user = userEvent.setup();
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository()}>
      <Launcher capture={(value) => { controller = value; }} />
    </MaterialLibraryProvider>);
    const oldOpen = vi.fn();
    const unregisterOld = controller.registerDocumentBrowser(oldOpen);
    const onInsert = vi.fn(async () => undefined);
    const currentOpen = vi.fn(() => controller.openBrowser({ targetLabel: "当前文档 · 光标处", onInsert }));
    const unregisterCurrent = controller.registerDocumentBrowser(currentOpen);
    unregisterOld();
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    expect(oldOpen).not.toHaveBeenCalled();
    expect(currentOpen).toHaveBeenCalledOnce();
    const insert = await screen.findByRole("button", { name: "插入到当前文档" });
    await waitFor(() => expect(insert).toBeEnabled());
    await user.click(insert);
    expect(onInsert).toHaveBeenCalledOnce();
    unregisterCurrent();
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeDisabled();
    expect(currentOpen).toHaveBeenCalledOnce();
  });

  it("creates without a project, keeps repeated saves open, and selects the new material after closing", async () => {
    const user = userEvent.setup();
    let current = structuredClone(material);
    let published = false;
    const contentEditor = editingRepository(() => current, (value) => { current = value; published = true; });
    contentEditor.beginCreate = vi.fn(async (payload) => {
      current = {
        ...material, id: "6474ce26-6a27-42cc-8be4-13a962fb1918", kind: payload.kind, payload,
        name: "", description: "", tags: [], revision: 0, metadataVersion: 0,
      };
      return { sessionId: "create-draft", material: structuredClone(current), isNew: true };
    });
    const createPreview = vi.fn(async () => undefined);
    const repo = repository({
      contentEditor, get: vi.fn(async () => structuredClone(current)),
      search: vi.fn(async (input) => {
        const items = published && !input.trash &&
          (input.exactName === undefined || input.exactName === current.name) ? [structuredClone(current)] : [];
        return { items, total: items.length, indexState: "ready" as const };
      }),
    });
    render(<MaterialLibraryProvider repository={repo} createPreview={createPreview}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await user.click(screen.getByRole("button", { name: "创建素材" }));
    const chooser = screen.getByRole("dialog", { name: "创建素材" });
    expect(within(chooser).getByRole("button", { name: "图片" })).toHaveFocus();
    expect(contentEditor.beginCreate).not.toHaveBeenCalled();
    expect(within(chooser).queryByRole("button", { name: "道具" })).not.toBeInTheDocument();
    expect(within(chooser).queryByRole("button", { name: "服装" })).not.toBeInTheDocument();
    await user.click(within(chooser).getByRole("button", { name: "道具与服装" }));
    await screen.findByDisplayValue("未命名道具与服装");
    expect(published).toBe(false);
    expect(contentEditor.beginCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "prop" }));
    await user.type(screen.getByRole("textbox", { name: "素材名称" }), "新建的道具素材");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "编辑素材" })).toBeVisible());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "素材名称" })).toBeEnabled());
    expect(published).toBe(true);
    expect(createPreview).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await screen.findByRole("button", { name: "选择素材：新建的道具素材" });
    await waitFor(() => expect(createPreview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: current.id, revision: 1, metadataVersion: 1,
    })));
    expect(screen.getByRole("button", { name: "全部素材" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("keeps failed creation choices retryable and retires a late draft after browser disposal", async () => {
    const user = userEvent.setup();
    const opening = deferred<MaterialEditSession>();
    const contentEditor = editingRepository();
    contentEditor.beginCreate = vi.fn().mockRejectedValueOnce(new Error("无法准备创建草稿"))
      .mockImplementationOnce(() => opening.promise);
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository({ contentEditor })}>
      <Launcher capture={(value) => { controller = value; }} />
    </MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(screen.getByRole("button", { name: "创建素材" }));
    const chooser = screen.getByRole("dialog", { name: "创建素材" });
    await user.click(within(chooser).getByRole("button", { name: "图片组" }));
    expect(await within(chooser).findByRole("alert")).toHaveTextContent("无法准备创建草稿");
    await user.click(within(chooser).getByRole("button", { name: "图片组" }));
    act(() => controller.close());
    opening.resolve({ sessionId: "late-creation", isNew: true, material });
    await waitFor(() => expect(contentEditor.discardEdit).toHaveBeenCalledExactlyOnceWith("late-creation"));
    expect(contentEditor.commitEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the dialog open when an inner interaction has consumed Escape", async () => {
    const user = userEvent.setup();
    render(<MaterialLibraryProvider repository={repository()}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(screen.getByRole("searchbox"), event);
    expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retires a draft that finishes opening after its browser has closed", async () => {
    const user = userEvent.setup();
    const opening = deferred<MaterialEditSession>();
    const contentEditor: MaterialContentEditorRepository = {
      beginCreate: vi.fn(),
      beginEdit: vi.fn(() => opening.promise), loadEditImage: vi.fn(),
      importEditImages: vi.fn(), captureEditImage: vi.fn(), cropEditImage: vi.fn(), commitEdit: vi.fn(),
      discardEdit: vi.fn(async () => undefined),
    };
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository({ contentEditor })}>
      <Launcher capture={(value) => { controller = value; }} />
    </MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(await screen.findByRole("button", { name: "编辑素材" }));
    expect(contentEditor.beginEdit).toHaveBeenCalledExactlyOnceWith(material.id, material.revision);
    act(() => controller.close());
    await act(async () => opening.resolve({ sessionId: "retired-draft", material }));
    await waitFor(() => expect(contentEditor.discardEdit).toHaveBeenCalledExactlyOnceWith("retired-draft"));
    expect(contentEditor.commitEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["预览", "完整组件预览"],
    ["编辑素材", "编辑素材"],
    ["删除", "删除素材？"],
  ])("keeps nested %s interactive across StrictMode effect replay", async (triggerName, title) => {
    const user = userEvent.setup();
    const { container } = render(
      <StrictMode>
        <MaterialLibraryProvider repository={repository({ contentEditor: editingRepository() })}><Launcher /></MaterialLibraryProvider>
      </StrictMode>,
    );
    const launcher = screen.getByRole("button", { name: "管理素材" });
    await user.click(launcher);
    const browser = screen.getByRole("dialog", { name: "素材库" });
    for (const dismiss of ["button", "escape", "backdrop"]) {
      const trigger = await screen.findByRole("button", { name: triggerName });
      await user.click(trigger);
      const surface = (await screen.findByRole("heading", { name: title, hidden: true }))
        .closest<HTMLElement>("[role=dialog]")!;
      const overlay = surface.parentElement!;
      expect(overlay).not.toHaveAttribute("inert");
      expect(overlay).not.toHaveAttribute("aria-hidden");
      expect(browser.closest("[inert]")).not.toBeNull();
      expect(surface.contains(document.activeElement)).toBe(true);
      await user.tab();
      expect(surface.contains(document.activeElement)).toBe(true);

      if (dismiss === "button") {
        await user.click(within(surface).getByRole("button", { name: `关闭${title}` }));
      } else if (dismiss === "escape") {
        await user.keyboard("{Escape}");
      } else {
        await user.click(overlay);
      }
      await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
      expect(browser.closest("[inert]")).toBeNull();
      expect(triggerName === "编辑素材" ? screen.getByRole("searchbox") : trigger,
        `Restore focus after ${dismiss} dismissal`).toHaveFocus();
    }
    await user.click(within(browser).getByRole("button", { name: "关闭素材库" }));
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
    expect(document.body.style.overflow).toBe("");
    expect(launcher).toHaveFocus();
  });

  it("is optional outside the provider", () => {
    render(<Launcher />);
    expect(screen.getByText("未提供素材库")).toBeVisible();
  });

  it("shows streamlined details without internal versions or an ownership notice", async () => {
    const user = userEvent.setup();
    render(<MaterialLibraryProvider repository={repository()}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await screen.findByRole("button", { name: "编辑素材" });
    expect(within(screen.getByRole("group", { name: "素材操作" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["编辑素材", "预览"]);
    for (const name of ["编辑内容", "编辑信息", "收藏素材", "刷新素材", "重新生成缩略图"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText("创建时间")).toBeVisible();
    expect(screen.getByText("最近更新", { selector: "dt" })).toBeVisible();
    expect(screen.queryAllByText(/内容版本|元数据版本/)).toHaveLength(0);
    expect(screen.queryByText("插入的是独立可编辑副本，不会关联素材库。修改或删除素材不影响已有项目。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "永久删除" })).not.toBeInTheDocument();
  });

  it.each(["cancel", "escape", "backdrop"])("does not purge a trashed material after %s dismissal", async (dismiss) => {
    const user = userEvent.setup();
    const trashed = { ...material, deletedAt: 10 };
    const purge = vi.fn();
    render(<StrictMode><MaterialLibraryProvider repository={repository({
      purge, get: vi.fn(async () => trashed),
      search: vi.fn(async () => ({ items: [trashed], total: 1, indexState: "ready" as const })),
    })}><Launcher /></MaterialLibraryProvider></StrictMode>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByRole("button", { name: "恢复素材" });
    const trigger = screen.getByRole("button", { name: "永久删除" });
    await user.click(trigger);
    const confirm = screen.getByRole("dialog", { name: "永久删除素材？" });
    expect(within(confirm).getByText(/无法恢复/)).toBeVisible();
    expect(within(confirm).getByText(/已插入项目的独立副本不受影响/)).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "取消" })).toHaveFocus();
    if (dismiss === "cancel") await user.click(within(confirm).getByRole("button", { name: "取消" }));
    else if (dismiss === "escape") await user.keyboard("{Escape}");
    else await user.click(confirm.parentElement!);
    expect(purge).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("button", { name: "恢复素材" })).toBeEnabled();
  });

  it("waits for durable purge, prevents repeat clicks, and removes only the selected item", async () => {
    const user = userEvent.setup();
    const deletion = deferred<void>();
    let items = [{ ...material, deletedAt: 10 }];
    const purge = vi.fn(async () => { await deletion.promise; items = []; });
    render(<MaterialLibraryProvider repository={repository({
      purge, get: vi.fn(async () => items[0]),
      search: vi.fn(async () => ({ items, total: items.length, indexState: "ready" as const })),
    })}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await user.click(await screen.findByRole("button", { name: "永久删除" }));
    const confirm = screen.getByRole("dialog", { name: "永久删除素材？" });
    await user.dblClick(within(confirm).getByRole("button", { name: "确认永久删除" }));
    expect(purge).toHaveBeenCalledExactlyOnceWith(material.id, material.metadataVersion);
    expect(within(confirm).getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(confirm).toBeVisible();
    await act(async () => deletion.resolve());
    expect(await screen.findByRole("heading", { name: "回收站为空" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "永久删除素材？" })).not.toBeInTheDocument();
    expect(screen.getByText("素材已永久删除。")).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("keeps a failed purge confirmation available for an explicit retry", async () => {
    const user = userEvent.setup();
    const trashed = { ...material, deletedAt: 10 };
    let items = [trashed];
    const purge = vi.fn<MaterialLibraryRepository["purge"]>()
      .mockRejectedValueOnce(new Error("素材正在编辑，请先关闭编辑画布"))
      .mockImplementationOnce(async () => { items = []; });
    render(<MaterialLibraryProvider repository={repository({
      purge, get: vi.fn(async () => trashed),
      search: vi.fn(async () => ({ items, total: items.length, indexState: "ready" as const })),
    })}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await user.click(await screen.findByRole("button", { name: "永久删除" }));
    const confirm = screen.getByRole("dialog", { name: "永久删除素材？" });
    await user.click(within(confirm).getByRole("button", { name: "确认永久删除" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("请先关闭编辑画布");
    expect(within(confirm).getByRole("button", { name: "取消" })).toBeEnabled();
    await user.click(within(confirm).getByRole("button", { name: "确认永久删除" }));
    expect(await screen.findByRole("heading", { name: "回收站为空" })).toBeVisible();
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("returns to the previous trash page when purging its last remaining item", async () => {
    const user = userEvent.setup();
    const first = { ...material, id: "first", deletedAt: 10, name: "保留素材" };
    const last = { ...material, deletedAt: 10 };
    let removed = false;
    const search = vi.fn<MaterialLibraryRepository["search"]>(async ({ offset }) => ({
      items: offset === 50 ? removed ? [] : [last] : [first],
      total: removed ? 50 : 51, indexState: "ready",
    }));
    render(<MaterialLibraryProvider repository={repository({
      search, get: vi.fn(async (id) => id === first.id ? first : last),
      purge: vi.fn(async () => { removed = true; }),
    })}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByRole("button", { name: "选择素材：保留素材" });
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
    await user.click(await screen.findByRole("button", { name: "永久删除" }));
    await user.click(screen.getByRole("button", { name: "确认永久删除" }));
    await screen.findByRole("button", { name: "选择素材：保留素材" });
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ trash: true, offset: 0 }));
    expect(screen.getByText("第 1 / 1 页 · 每页 50 份")).toBeVisible();
  });

  it("shows unavailable desktop-only guidance without issuing repository calls", async () => {
    const user = userEvent.setup();
    const repo = repository({ availability: "unavailable" });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "从库插入" }));
    expect(screen.getByText(/请使用 Preshot 桌面版/)).toBeVisible();
    expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建素材" })).toBeDisabled();
    expect(repo.search).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    expect(screen.getByRole("button", { name: "保存素材" })).toBeDisabled();
  });

  it("traps focus, makes the background inert, restores focus, and never inserts on selection", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn(async () => undefined);
    const { container } = render(<MaterialLibraryProvider repository={repository()}><Launcher onInsert={onInsert} /></MaterialLibraryProvider>);
    const trigger = screen.getByRole("button", { name: "从库插入" });
    await user.click(trigger);
    const search = screen.getByRole("searchbox");
    expect(search).toHaveFocus();
    expect(container).toHaveAttribute("inert");
    await user.click(await screen.findByRole("button", { name: "选择素材：窗边参考" }));
    expect(await screen.findByText("下午拍摄")).toBeVisible();
    expect(onInsert).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(container).not.toHaveAttribute("inert");
  });

  it("debounces Chinese search by 180ms and waits for IME composition to finish", async () => {
    const user = userEvent.setup();
    const repo = repository();
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
    expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: "", sort: "recent", limit: 50 }));
    vi.useFakeTimers();
    const search = screen.getByRole("searchbox");
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "窗" } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(repo.search).toHaveBeenCalledTimes(1);
    fireEvent.change(search, { target: { value: "窗光" } });
    fireEvent.compositionEnd(search, { data: "窗光" });
    await act(() => vi.advanceTimersByTimeAsync(179));
    expect(repo.search).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ query: "窗光", sort: "relevance", offset: 0, limit: 50 }));
    expect(search).toHaveFocus();
  });

  it("ignores an obsolete search response and keeps the query when reopening", async () => {
    const user = userEvent.setup();
    const old = deferred<{ items: MaterialDetail[]; total: number; indexState: "ready" }>();
    const repo = repository({
      search: vi.fn<MaterialLibraryRepository["search"]>((input) => input.query === "" ? old.promise :
        Promise.resolve({ items: [material], total: 1, indexState: "ready" })),
    });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.type(screen.getByRole("searchbox"), "窗边");
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
    await act(async () => old.resolve({ items: [{ ...material, name: "过时结果" }], total: 1, indexState: "ready" }));
    expect(screen.queryByRole("button", { name: "选择素材：过时结果" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    expect(screen.getByRole("searchbox")).toHaveValue("窗边");
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
  });

  it("uses repository filters and 50-item pagination", async () => {
    const user = userEvent.setup();
    const repo = repository({ search: vi.fn<MaterialLibraryRepository["search"]>(async () => ({ items: [material], total: 101, indexState: "rebuilding" })) });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    expect(await screen.findByText(/搜索索引正在重建/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50, limit: 50 })));
    expect(screen.queryByRole("button", { name: "道具" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "服装" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "道具与服装" }));
    await waitFor(() => expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "propClothing", offset: 0 })));
    await user.click(screen.getByRole("button", { name: "收藏" }));
    await waitFor(() => expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ favorites: true })));
    await user.selectOptions(screen.getByRole("combobox", { name: "排序方式" }), "name");
    await waitFor(() => expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "name" })));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await waitFor(() => expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ trash: true })));
  });

  it("surfaces storage failures instead of presenting an empty library and supports retry", async () => {
    const user = userEvent.setup();
    const search = vi.fn<MaterialLibraryRepository["search"]>()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValue({ items: [material], total: 1, indexState: "ready" });
    render(<MaterialLibraryProvider repository={repository({ search })}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取素材库");
    expect(screen.queryByText("还没有素材")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试读取素材库" }));
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
  });

  it("waits for durable insert, prevents double submit and keeps the dialog on error", async () => {
    const user = userEvent.setup();
    const insert = deferred<void>();
    const onInsert = vi.fn(() => insert.promise);
    render(<MaterialLibraryProvider repository={repository()}><Launcher onInsert={onInsert} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "从库插入" }));
    const button = screen.getByRole("button", { name: "插入到当前文档" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.dblClick(button);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible();
    await act(async () => insert.reject(new Error("项目已切换，请重新打开插入窗口")));
    expect(screen.getByRole("alert")).toHaveTextContent("项目已切换");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(button).toBeEnabled();
  });

  it("does not close a new destination when an obsolete insertion resolves", async () => {
    const user = userEvent.setup();
    const insert = deferred<void>();
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository()}><Launcher onInsert={() => insert.promise} capture={(value) => { controller = value; }} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "从库插入" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "插入到当前文档" }));
    act(() => controller.openBrowser({ targetLabel: "新项目 · 文档开头", onInsert: async () => undefined }));
    await act(async () => insert.resolve());
    expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible();
    expect(screen.getByText("插入位置：新项目 · 文档开头")).toBeVisible();
  });

  it("disables insertion when original images are missing, but permits retry", async () => {
    const user = userEvent.setup();
    const withImage: MaterialDetail = {
      ...material, imageCount: 1,
      images: [{ localImageId: "image-1", blobId: "blob", mimeType: "image/png", byteLength: 10, width: 100, height: 100 }],
      payload: {
        ...material.payload,
        component: { kind: "imageGroup", name: "原组件标题", description: "完整参考说明",
          images: [{ localImageId: "image-1", aspectRatio: 1, frameWidth: 100, frameHeight: 100 }] },
      },
    };
    const loadImage = vi.fn<MaterialLibraryRepository["loadImage"]>()
      .mockRejectedValueOnce(new Error("原图缺失")).mockResolvedValue("data:image/png;base64,AA==");
    const repo = repository({
      get: vi.fn(async () => withImage), loadImage,
      search: vi.fn<MaterialLibraryRepository["search"]>(async () => ({ items: [withImage], total: 1, indexState: "ready" })),
    });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "从库插入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("第 1 张原始图片不可用");
    expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新检查图片" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeEnabled());
    expect(loadImage).toHaveBeenCalledWith(withImage.id, 1, "image-1");
  });

  it("requires a valid name, tags and description, focuses invalid fields, and does not submit during IME", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => material);
    render(<MaterialLibraryProvider repository={repository()}><Launcher onSave={onSave} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    const name = screen.getByRole("textbox", { name: "素材名称" });
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请填写素材名称");
    expect(name).toHaveFocus();
    await user.type(name, "窗光");
    const tags = screen.getByRole("textbox", { name: "标签" });
    fireEvent.change(tags, { target: { value: Array.from({ length: 13 }, (_, index) => `标签${index}`).join("，") } });
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(screen.getByRole("alert")).toHaveTextContent("标签最多 12 个");
    expect(tags).toHaveFocus();
    fireEvent.change(tags, { target: { value: "窗光，窗光" } });
    const description = screen.getByRole("textbox", { name: "素材说明" });
    fireEvent.change(description, { target: { value: "字".repeat(1001) } });
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(screen.getByRole("alert")).toHaveTextContent("素材说明最多 1000 字");
    expect(description).toHaveFocus();
    fireEvent.change(description, { target: { value: "" } });
    fireEvent.compositionStart(name);
    fireEvent.keyDown(name, { key: "Enter", isComposing: true });
    fireEvent.submit(name.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.compositionEnd(name);
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: "窗光", tags: ["窗光"], description: "", favorite: false }));
  });

  it("warns about duplicate names and hidden legacy images and never overwrites a material", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => material);
    const source = { ...snapshot, omittedLegacyImages: 2 };
    render(<MaterialLibraryProvider repository={repository()}><Launcher onSave={onSave} source={source} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    const name = screen.getByRole("textbox", { name: "素材名称" });
    await user.clear(name);
    await user.type(name, "窗边参考");
    expect(await screen.findByText("已有同名素材，保存后会新增一份，不会覆盖。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "我确认仅保存可见主图库" })).toHaveFocus();
    await user.click(screen.getByRole("checkbox", { name: "我确认仅保存可见主图库" }));
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    const confirm = await screen.findByRole("dialog", { name: "保存同名素材？" });
    expect(onSave).not.toHaveBeenCalled();
    expect(within(confirm).getByText(/不会覆盖已有素材/)).toBeVisible();
    await user.click(within(confirm).getByRole("button", { name: "仍然保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("素材已保存");
    expect(screen.queryByRole("button", { name: "保存素材" })).not.toBeInTheDocument();
  });

  it.each(["cancel", "escape", "backdrop"])("keeps the save draft when duplicate confirmation is dismissed by %s", async (dismiss) => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => material);
    const repo = repository();
    render(<StrictMode><MaterialLibraryProvider repository={repo}><Launcher onSave={onSave} /></MaterialLibraryProvider></StrictMode>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    const name = screen.getByRole("textbox", { name: "素材名称" });
    fireEvent.change(name, { target: { value: " 窗边参考 " } });
    const save = screen.getByRole("button", { name: "保存素材" });
    await user.click(save);
    const confirm = await screen.findByRole("dialog", { name: "保存同名素材？" });
    expect(repo.search).toHaveBeenCalledWith({ query: "", exactName: "窗边参考", sort: "name", offset: 0, limit: 1 });
    expect(within(confirm).getByRole("button", { name: "取消" })).toHaveFocus();
    expect(name.closest("[inert]")).not.toBeNull();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(within(confirm).getByRole("button", { name: "仍然保存" })).toHaveFocus();
    if (dismiss === "cancel") await user.click(within(confirm).getByRole("button", { name: "取消" }));
    else if (dismiss === "escape") await user.keyboard("{Escape}");
    else await user.click(confirm.parentElement!);
    expect(onSave).not.toHaveBeenCalled();
    expect(name).toHaveValue(" 窗边参考 ");
    expect(save).toHaveFocus();
    fireEvent.change(name, { target: { value: "另一份素材" } });
    await user.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({
      name: "另一份素材", description: "", tags: [], favorite: false,
    }));
  });

  it("checks again at submit, waits for the result and persists once only after duplicate confirmation", async () => {
    const user = userEvent.setup();
    const checking = deferred<{ items: MaterialDetail[]; total: number; indexState: "ready" }>();
    const saving = deferred<MaterialDetail>();
    const onSave = vi.fn(() => saving.promise);
    const search = vi.fn<MaterialLibraryRepository["search"]>().mockResolvedValue({ items: [], total: 0, indexState: "ready" });
    render(<MaterialLibraryProvider repository={repository({ search })}><Launcher onSave={onSave} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    fireEvent.change(screen.getByRole("textbox", { name: "素材名称" }), { target: { value: material.name } });
    await waitFor(() => expect(search).toHaveBeenCalled());
    search.mockImplementation(() => checking.promise);
    await user.dblClick(screen.getByRole("button", { name: "保存素材" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存素材" })).toBeDisabled();
    expect(screen.getByText("正在检查同名素材…")).toBeVisible();
    await act(async () => checking.resolve({ items: [material], total: 1, indexState: "ready" }));
    const confirm = await screen.findByRole("dialog", { name: "保存同名素材？" });
    await user.dblClick(within(confirm).getByRole("button", { name: "仍然保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => saving.resolve(material));
    expect(await screen.findByRole("alert")).toHaveTextContent("素材已保存");
  });

  it("blocks saving on a failed name lookup and allows an explicit retry", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => material);
    const search = vi.fn<MaterialLibraryRepository["search"]>().mockRejectedValue(new Error("读取失败"));
    render(<MaterialLibraryProvider repository={repository({ search })}><Launcher onSave={onSave} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法检查同名素材");
    expect(onSave).not.toHaveBeenCalled();
    search.mockResolvedValue({ items: [], total: 0, indexState: "ready" });
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("never saves from a name lookup that resolves after its dialog has closed", async () => {
    const user = userEvent.setup();
    const checking = deferred<{ items: MaterialDetail[]; total: number; indexState: "ready" }>();
    const onSave = vi.fn(async () => material);
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository({ search: vi.fn(() => checking.promise) })}>
      <Launcher onSave={onSave} capture={(value) => { controller = value; }} />
    </MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    act(() => controller.close());
    await act(async () => checking.resolve({ items: [], total: 0, indexState: "ready" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reports canonical save success with thumbnail failure and retries only the thumbnail", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => material);
    const createPreview = vi.fn<(value: MaterialDetail) => Promise<void>>()
      .mockRejectedValueOnce(new Error("截图失败")).mockResolvedValueOnce();
    render(<MaterialLibraryProvider repository={repository()} createPreview={createPreview}><Launcher onSave={onSave} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("文字和图片已安全保存");
    expect(screen.getByRole("dialog", { name: "保存到素材库" })).toBeVisible();
    expect(onSave).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "重试生成缩略图" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createPreview).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("renames through the unified CAS save without mutating component contents", async () => {
    const user = userEvent.setup();
    let current = structuredClone(material);
    const contentEditor = editingRepository(() => current, (value) => { current = value; });
    const repo = repository({
      get: vi.fn(async () => current), contentEditor,
      search: vi.fn<MaterialLibraryRepository["search"]>(async () => ({ items: [current], total: 1, indexState: "ready" })),
    });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(await screen.findByRole("button", { name: "编辑素材" }));
    const editor = await screen.findByRole("dialog", { name: "编辑素材" });
    const name = within(editor).getByRole("textbox", { name: "素材名称" });
    await user.clear(name);
    await user.type(name, "新的检索名称");
    await user.click(within(editor).getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(within(editor).getByRole("button", { name: "关闭" })).toBeEnabled());
    expect(editor).toBeVisible();
    await user.click(within(editor).getByRole("button", { name: "关闭" }));
    await screen.findByRole("button", { name: "选择素材：新的检索名称" });
    expect(contentEditor.commitEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      payload: material.payload, metadataUpdate: { expectedVersion: 3, metadata: {
        name: "新的检索名称", description: "下午拍摄", tags: ["窗光"], favorite: false,
      } },
    }));
    expect(repo.updateMetadata).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "编辑素材" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("heading", { name: "原组件标题" })).toBeVisible();
  });

  it("refreshes the committed component and cached preview only after the editor closes", async () => {
    const user = userEvent.setup();
    let current = structuredClone(material);
    let cache: string | null = null;
    const preview = deferred<void>();
    const contentEditor = editingRepository(() => current, (value) => { current = value; });
    const createPreview = vi.fn(async () => {
      await preview.promise;
      cache = "data:image/png;base64,YWJj";
    });
    const repo = repository({
      contentEditor, get: vi.fn(async () => structuredClone(current)),
      search: vi.fn(async () => ({ items: [structuredClone(current)], total: 1, indexState: "ready" as const })),
      loadPreview: vi.fn(async () => cache),
    });
    render(<MaterialLibraryProvider repository={repo} createPreview={createPreview}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(await screen.findByRole("button", { name: "编辑素材" }));
    const editor = await screen.findByRole("dialog", { name: "编辑素材" });
    await user.type(within(editor).getByRole("textbox", { name: "素材名称" }), "修改");
    const title = await within(editor).findByRole("textbox", { name: "图片组名称" });
    await user.clear(title);
    await user.type(title, "保存后的组件");
    const reads = vi.mocked(repo.get).mock.calls.length;
    await user.click(within(editor).getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(within(editor).getByRole("button", { name: "关闭" })).toBeEnabled());
    expect(createPreview).not.toHaveBeenCalled();
    expect(repo.get).toHaveBeenCalledTimes(reads);
    expect(editor).toBeVisible();
    await user.click(within(editor).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑素材" })).not.toBeInTheDocument());
    await waitFor(() => expect(createPreview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: "窗边参考修改", revision: 2, payload: expect.objectContaining({ component: expect.objectContaining({ name: "保存后的组件" }) }),
    })));
    expect(screen.queryByRole("region", { name: "组件只读预览" })).not.toBeInTheDocument();
    await act(async () => preview.resolve());
    expect(await screen.findByRole("img", { name: "窗边参考修改的组件缩略图" })).toHaveAttribute("src", cache);
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("heading", { name: "保存后的组件" })).toBeVisible();
    expect(contentEditor.commitEdit).toHaveBeenCalledOnce();
  });

  it("retries a failed preview after close without submitting another material save", async () => {
    const user = userEvent.setup();
    let current = structuredClone(material);
    const contentEditor = editingRepository(() => current, (value) => { current = value; });
    const createPreview = vi.fn<(value: MaterialDetail) => Promise<void>>()
      .mockRejectedValueOnce(new Error("预览生成失败")).mockResolvedValueOnce();
    const repo = repository({
      contentEditor, get: vi.fn(async () => structuredClone(current)),
      search: vi.fn(async () => ({ items: [structuredClone(current)], total: 1, indexState: "ready" as const })),
    });
    render(<MaterialLibraryProvider repository={repo} createPreview={createPreview}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(await screen.findByRole("button", { name: "编辑素材" }));
    await user.type(await screen.findByRole("textbox", { name: "素材名称" }), "修改");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("素材已保存");
    expect(screen.queryByRole("dialog", { name: "编辑素材" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试更新预览" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试更新预览" })).not.toBeInTheDocument());
    expect(createPreview).toHaveBeenCalledTimes(2);
    expect(contentEditor.commitEdit).toHaveBeenCalledOnce();
  });

  it("retires a next draft that finishes opening after a saved editor is externally closed", async () => {
    const user = userEvent.setup();
    let current = structuredClone(material);
    const contentEditor = editingRepository(() => current, (value) => { current = value; });
    const opening = deferred<MaterialEditSession>();
    vi.mocked(contentEditor.beginEdit).mockResolvedValueOnce({ sessionId: "original", material })
      .mockReturnValueOnce(opening.promise);
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository({ contentEditor })}>
      <Launcher capture={(value) => { controller = value; }} />
    </MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(await screen.findByRole("button", { name: "编辑素材" }));
    await user.type(await screen.findByRole("textbox", { name: "素材名称" }), "修改");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    await waitFor(() => expect(contentEditor.beginEdit).toHaveBeenCalledTimes(2));
    act(() => controller.close());
    await act(async () => opening.resolve({ sessionId: "late-next", material: current }));
    await waitFor(() => expect(contentEditor.discardEdit).toHaveBeenCalledWith("late-next"));
    expect(contentEditor.commitEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms soft deletion, restores with CAS, and isolates nested dialog focus", async () => {
    const user = userEvent.setup();
    let current = structuredClone(material);
    const setDeleted = vi.fn<MaterialLibraryRepository["setDeleted"]>(async (_id, _version, deleted) => {
      current = { ...current, deletedAt: deleted ? 10 : null, metadataVersion: current.metadataVersion + 1 };
      return current;
    });
    const repo = repository({
      get: vi.fn(async () => current), setDeleted,
      search: vi.fn<MaterialLibraryRepository["search"]>(async ({ trash }) => ({ items: Boolean(current.deletedAt) === Boolean(trash) ? [current] : [], total: 1, indexState: "ready" })),
    });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    const trigger = screen.getByRole("button", { name: "管理素材" });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "删除" }));
    const confirm = screen.getByRole("dialog", { name: "删除素材？" });
    expect(within(confirm).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(confirm).getByRole("button", { name: "关闭删除素材？" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(confirm).getByRole("button", { name: "确认删除" })).toHaveFocus();
    expect(setDeleted).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(setDeleted).toHaveBeenCalledWith(material.id, 3, true));
    await user.click(screen.getByRole("button", { name: "回收站" }));
    await user.click(await screen.findByRole("button", { name: "恢复素材" }));
    await waitFor(() => expect(setDeleted).toHaveBeenLastCalledWith(material.id, 4, false));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeEnabled());
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores inert state and scrolling when closed externally with a nested preview open", async () => {
    const user = userEvent.setup();
    let controller!: MaterialLibraryController;
    const { container } = render(<MaterialLibraryProvider repository={repository()}><Launcher capture={(value) => { controller = value; }} /></MaterialLibraryProvider>, { wrapper: StrictMode });
    const trigger = screen.getByRole("button", { name: "管理素材" });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "预览" }));
    expect(screen.getByRole("dialog", { name: "完整组件预览" })).toBeVisible();
    act(() => controller.close());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("aria-hidden");
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("does not show stale selected details or enable insertion before originals are checked", async () => {
    const user = userEvent.setup();
    const first = deferred<MaterialDetail>();
    const other = { ...material, id: "e0e8a9dd-c142-47f5-811c-785dca22a98b", name: "第二份素材" };
    const repo = repository({
      get: vi.fn((id) => id === material.id ? first.promise : Promise.resolve(other)),
      search: vi.fn<MaterialLibraryRepository["search"]>(async () => ({ items: [material, other], total: 2, indexState: "ready" })),
    });
    render(<MaterialLibraryProvider repository={repo}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "从库插入" }));
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
    expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "选择素材：第二份素材" }));
    await screen.findByRole("heading", { name: "第二份素材" });
    await act(async () => first.resolve(material));
    expect(screen.getByRole("heading", { name: "第二份素材" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "窗边参考" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeEnabled();
  });

  it("keeps the unified editor correctable after a definite metadata conflict", async () => {
    const user = userEvent.setup();
    const contentEditor = editingRepository();
    vi.mocked(contentEditor.commitEdit).mockRejectedValue(new MaterialContentSaveError("素材信息已变化，请重新打开编辑窗口", "rejected"));
    render(<MaterialLibraryProvider repository={repository({ contentEditor })}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await user.click(await screen.findByRole("button", { name: "编辑素材" }));
    const name = await screen.findByRole("textbox", { name: "素材名称" });
    await user.type(name, "修改");
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("素材信息已变化");
    expect(screen.getByRole("dialog", { name: "编辑素材" })).toBeVisible();
    expect(name).toBeEnabled();
    expect(name).toHaveValue("窗边参考修改");
    expect(screen.getByRole("button", { name: "保存素材" })).toBeEnabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible());
  });

  it("waits for canonical save before generating a thumbnail and blocks dismissal during both phases", async () => {
    const user = userEvent.setup();
    const save = deferred<MaterialDetail>();
    const preview = deferred<void>();
    const createPreview = vi.fn(() => preview.promise);
    const onSave = vi.fn(() => save.promise);
    render(<MaterialLibraryProvider repository={repository()} createPreview={createPreview}><Launcher onSave={onSave} /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    await user.dblClick(screen.getByRole("button", { name: "保存素材" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(createPreview).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "保存到素材库" })).toBeVisible();
    await act(async () => save.resolve(material));
    expect(createPreview).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    expect(screen.getByText("内容已保存，正在准备缩略图…")).toBeVisible();
    await act(async () => preview.resolve());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a backdrop click and restores the triggering focus", async () => {
    const user = userEvent.setup();
    render(<MaterialLibraryProvider repository={repository()}><Launcher /></MaterialLibraryProvider>);
    const trigger = screen.getByRole("button", { name: "管理素材" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "素材库" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the controller and its callbacks stable across dialog state changes", async () => {
    const user = userEvent.setup();
    const capture = vi.fn<(controller: MaterialLibraryController) => void>();
    const repo = repository();
    render(<MaterialLibraryProvider repository={repo}><Launcher capture={capture} /></MaterialLibraryProvider>);
    const original = capture.mock.calls[0][0];
    await user.click(screen.getByRole("button", { name: "管理素材" }));
    await screen.findByRole("button", { name: "选择素材：窗边参考" });
    await user.click(screen.getByRole("button", { name: "预览" }));
    await user.keyboard("{Escape}{Escape}");
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    act(() => original.close());
    expect(capture).toHaveBeenCalledTimes(1);
    expect(original.repository).toBe(repo);
    expect(capture.mock.calls.at(-1)?.[0]).toBe(original);
  });

  it("allows the owner to retire a busy save without cancelling native work or reusing its result", async () => {
    const user = userEvent.setup();
    const save = deferred<MaterialDetail>();
    const onSave = vi.fn(() => save.promise);
    const createPreview = vi.fn(async () => undefined);
    let controller!: MaterialLibraryController;
    render(<MaterialLibraryProvider repository={repository()} createPreview={createPreview}>
      <Launcher onSave={onSave} capture={(value) => { controller = value; }} />
    </MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "保存当前组件" }));
    await user.click(screen.getByRole("button", { name: "保存素材" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    act(() => controller.close());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => controller.openBrowser());
    await act(async () => save.resolve(material));
    expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible();
    expect(createPreview).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it.each(["管理素材", "从库插入"])("renders a preview only on request when opened through %s", async (entry) => {
    const user = userEvent.setup();
    const second = { ...material, id: "226f6001-cbcb-4c77-b8a0-1833fdf0c7a7", name: "第二份素材" };
    const repo = repository({
      search: vi.fn(async () => ({ items: [material, second], total: 2, indexState: "ready" as const })),
      get: vi.fn(async (id) => id === second.id ? second : material),
    });
    const renderPreview = vi.fn((value: MaterialDetail) => <article>{value.name}的完整内容</article>);
    render(<MaterialLibraryProvider repository={repo} renderPreview={renderPreview}><Launcher /></MaterialLibraryProvider>);

    await user.click(screen.getByRole("button", { name: entry }));
    await screen.findByRole("button", { name: "预览" });
    expect(renderPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "组件只读预览" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "选择素材：第二份素材" }));
    await screen.findByRole("heading", { name: second.name });
    expect(renderPreview).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "预览" }));
    const preview = screen.getByRole("dialog", { name: "完整组件预览" });
    expect(within(preview).getByText("第二份素材的完整内容")).toBeVisible();
    expect(renderPreview).toHaveBeenCalledExactlyOnceWith(second);

    await user.click(within(preview).getByRole("button", { name: "关闭完整组件预览" }));
    expect(screen.queryByRole("region", { name: "组件只读预览" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "选择素材：窗边参考" }));
    await screen.findByRole("heading", { name: material.name });
    expect(renderPreview).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(within(screen.getByRole("dialog", { name: "完整组件预览" })).getByText("窗边参考的完整内容")).toBeVisible();
    expect(renderPreview).toHaveBeenCalledTimes(2);
    expect(renderPreview).toHaveBeenLastCalledWith(material);
  });

  it("explicitly labels partial cached thumbnails without restricting the full component preview", async () => {
    const user = userEvent.setup();
    const partial = { ...material, previewState: "ready" as const, previewPartial: true };
    const repo = repository({
      get: vi.fn(async () => partial),
      loadPreview: vi.fn(async () => "data:image/png;base64,AA=="),
      search: vi.fn<MaterialLibraryRepository["search"]>(async () => ({ items: [partial], total: 1, indexState: "ready" })),
    });
    const renderPreview = vi.fn((value: MaterialDetail) => <article>
      <p>{value.payload.component.kind === "imageGroup" ? value.payload.component.description : ""}</p>
    </article>);
    render(<MaterialLibraryProvider repository={repo} renderPreview={renderPreview}><Launcher /></MaterialLibraryProvider>);
    await user.click(screen.getByRole("button", { name: "从库插入" }));
    expect(await screen.findByRole("img", { name: "窗边参考的局部缩略图" })).toBeVisible();
    expect(screen.getByText("局部缩略图 · 请查看完整预览")).toBeVisible();
    expect(await screen.findByText("缓存缩略图仅展示组件的一部分，不代表内容缺失。请打开预览查看完整内容。")).toBeVisible();
    expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "预览" }));
    const full = screen.getByRole("dialog", { name: "完整组件预览" });
    expect(within(full).getByText("完整参考说明")).toBeVisible();
    expect(renderPreview).toHaveBeenLastCalledWith(partial);
  });

  it.each(["success", "failure"] as const)(
    "forcibly retires a pending insert without aborting native work or applying stale %s",
    async (outcome) => {
      const user = userEvent.setup();
      const insert = deferred<void>();
      const onInsert = vi.fn(() => insert.promise);
      const repo = repository();
      let controller!: MaterialLibraryController;
      render(<MaterialLibraryProvider repository={repo}>
        <Launcher onInsert={onInsert} capture={(value) => { controller = value; }} />
      </MaterialLibraryProvider>);
      await user.click(screen.getByRole("button", { name: "从库插入" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "插入到当前文档" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "插入到当前文档" }));
      expect(screen.getByRole("button", { name: "关闭素材库" })).toBeDisabled();
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible();
      act(() => controller.close());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(repo.abortInsert).not.toHaveBeenCalled();
      act(() => controller.openBrowser());
      await act(async () => {
        if (outcome === "success") insert.resolve();
        else insert.reject(new Error("旧目标项目已关闭"));
      });
      expect(screen.getByRole("dialog", { name: "素材库" })).toBeVisible();
      expect(screen.queryByText(/旧目标项目已关闭/)).not.toBeInTheDocument();
      expect(onInsert).toHaveBeenCalledOnce();
      expect(repo.abortInsert).not.toHaveBeenCalled();
      expect(repo.commitInsert).not.toHaveBeenCalled();
    },
  );
});
