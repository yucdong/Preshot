// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MaterialDetail, MaterialEditImage } from "../../domain/library/models";
import type { MaterialContentEditorRepository } from "../../domain/library/ports";
import { MaterialContentCanvas, type MaterialContentCanvasHandle } from "./MaterialContentCanvas";
import { createEmptyMaterialPayload } from "../../domain/library/materialCreation";
import { componentImages } from "../../domain/library/materialStructure";
import { LibraryDialog } from "./LibraryDialog";

function model(): MaterialDetail {
  return {
    id: "material-model", kind: "modelCard", revision: 1, metadataVersion: 1,
    name: "素材", description: "", tags: [], favorite: false,
    createdAt: 1, updatedAt: 1, deletedAt: null, imageCount: 0, byteLength: 0,
    previewState: "pending", images: [],
    payload: { format: "preshot-material", version: 1, kind: "modelCard",
      component: { kind: "modelCard", modelId: "原模特", heightCm: 170,
        weightKg: 50, shoeSize: "38", samples: { images: [] } } },
  };
}
function repository(): MaterialContentEditorRepository {
  return {
    beginCreate: vi.fn(), beginEdit: vi.fn(), loadEditImage: vi.fn(), importEditImages: vi.fn(),
    captureEditImage: vi.fn(), cropEditImage: vi.fn(), commitEdit: vi.fn(), discardEdit: vi.fn(),
  };
}

describe("MaterialContentCanvas", () => {
  it("reviews suspect captures outside the inert canvas, cancels safely and preserves an explicitly kept image", async () => {
    const repo = repository();
    const ref = createRef<MaterialContentCanvasHandle>();
    const image: MaterialEditImage = { localImageId: "dark", mimeType: "image/png", byteLength: 1,
      width: 3000, height: 500, dataUrl: "data:image/png;base64,AA" };
    repo.captureEditImage = vi.fn(async (_id, cancellation, review) => {
      return await review!({ reason: "uniformDark", previewUrl: image.dataUrl }, cancellation) === "keep" ? image : null;
    });
    render(<MaterialContentCanvas material={model()} assets={new Map()} sessionId="review-session"
      repository={repo} onChange={vi.fn()} onBusyChange={vi.fn()} onError={vi.fn()} ref={ref} />);
    fireEvent.click(await screen.findByRole("button", { name: "截图" }));
    const dialog = await screen.findByRole("dialog", { name: "检查截图" });
    expect(dialog.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "重新截图" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "检查截图" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "截图" })).toBeEnabled());
    expect(componentImages(ref.current!.readPayload().component)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "截图" }));
    fireEvent.click(await screen.findByRole("button", { name: "保留截图" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeEnabled());
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(componentImages(ref.current!.readPayload().component)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(componentImages(ref.current!.readPayload().component)).toHaveLength(1);
  });
  it("keeps batch progress accessible outside the locked canvas and clears it on failure and picker cancellation", async () => {
    const repo = repository();
    const onError = vi.fn();
    let fail!: (reason: Error) => void;
    repo.importEditImages = vi.fn((_session, onSelected) => {
      onSelected?.(3);
      return new Promise<MaterialEditImage[]>((_resolve, reject) => { fail = reject; });
    });
    render(<MaterialContentCanvas material={model()} assets={new Map()} sessionId="progress-session"
      repository={repo} onChange={vi.fn()} onBusyChange={vi.fn()} onError={onError} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "添加图片" }))[0]);
    const bar = await screen.findByRole("progressbar", { name: "图片加载进度" });
    expect(bar.closest("[inert]")).toBeNull();
    expect(bar).not.toHaveAttribute("value");
    expect(screen.getByText("正在加载 3 张图片…")).toBeVisible();
    await act(async () => fail(new Error("测试导入失败")));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("测试导入失败"));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    vi.mocked(repo.importEditImages).mockResolvedValueOnce([]);
    fireEvent.click(screen.getAllByRole("button", { name: "添加图片" })[0]);
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    expect(repo.importEditImages).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("button", { name: "添加图片" })[0]).toBeEnabled();
  });
  it("opens a saved group's originals without selection and requires the first save for new groups", async () => {
    const repo = repository();
    repo.revealEditImageGroup = vi.fn().mockResolvedValue(undefined);
    repo.revealEditImage = vi.fn();
    const material = { ...model(), kind: "imageGroup" as const, payload: createEmptyMaterialPayload("imageGroup", "参考图") };
    const onChange = vi.fn();
    const props = { material, assets: new Map<string, string>(), sessionId: "group-session",
      repository: repo, onChange, onBusyChange: vi.fn(), onError: vi.fn() };
    const { rerender } = render(<MaterialContentCanvas {...props} />);
    const button = await screen.findByRole("button", { name: "打开原图所在位置" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(repo.revealEditImageGroup).toHaveBeenCalledExactlyOnceWith("group-session"));
    expect(repo.revealEditImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(repo.commitEdit).not.toHaveBeenCalled();
    rerender(<MaterialContentCanvas {...props} material={{ ...material, revision: 0 }} />);
    expect(screen.getByRole("button", { name: "打开原图所在位置" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "打开原图所在位置" })).toHaveAttribute("title", "保存素材后可打开原图目录");
  });

  it("reveals only the selected draft image without saving or changing content", async () => {
    const repo = repository();
    repo.revealEditImage = vi.fn().mockResolvedValue(undefined);
    repo.importEditImages = vi.fn().mockResolvedValue(["first", "second"].map((localImageId) => ({
      localImageId, mimeType: "image/png", byteLength: 1,
      width: 20, height: 20, dataUrl: "data:image/png;base64,AA",
    })));
    const material = { ...model(), kind: "imageGroup" as const, payload: createEmptyMaterialPayload("imageGroup", "参考图") };
    const onChange = vi.fn();
    const onError = vi.fn();
    const ref = createRef<MaterialContentCanvasHandle>();
    render(<MaterialContentCanvas material={material} assets={new Map()} sessionId="reveal-session"
      repository={repo} onChange={onChange} onBusyChange={vi.fn()} onError={onError} ref={ref} />);
    expect(await screen.findByRole("button", { name: "打开原图所在位置" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "添加图片" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "选择参考图 2" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择参考图 2" }));
    const before = ref.current!.readPayload();
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "打开原图所在位置" }));
    await waitFor(() => expect(repo.revealEditImage).toHaveBeenCalledExactlyOnceWith("reveal-session", "second"));
    await waitFor(() => expect(ref.current!.readPayload()).toEqual(before));
    expect(onChange).not.toHaveBeenCalled();
    expect(repo.commitEdit).not.toHaveBeenCalled();
    vi.mocked(repo.revealEditImage).mockRejectedValueOnce(new Error("原图已丢失"));
    fireEvent.click(screen.getByRole("button", { name: "打开原图所在位置" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("原图已丢失")));
    fireEvent.click(screen.getByRole("button", { name: "打开原图所在位置" }));
    await waitFor(() => expect(repo.revealEditImage).toHaveBeenCalledTimes(3));
  });

  it.each(["prop", "clothing"] as const)("edits legacy %s under the merged category without changing its payload kind", async (kind) => {
    const ref = createRef<MaterialContentCanvasHandle>();
    const material = { ...model(), kind, payload: createEmptyMaterialPayload(kind, "原名称") };
    render(<MaterialContentCanvas material={material} assets={new Map()} sessionId="merged-category"
      repository={repository()} onChange={vi.fn()} onBusyChange={vi.fn()} onError={vi.fn()} ref={ref} />);
    const title = await screen.findByRole("textbox", { name: "道具与服装名称" });
    fireEvent.change(title, { target: { value: "新名称" } });
    fireEvent.blur(title);
    const source = screen.getByRole("textbox", { name: "道具与服装信息" });
    fireEvent.change(source, { target: { value: "品牌、来源和拍摄说明" } });
    fireEvent.blur(source);
    expect(ref.current!.readPayload()).toMatchObject({
      kind, component: { kind, title: "新名称", source: "品牌、来源和拍摄说明" },
    });
    expect(screen.getByRole("group", { name: "道具与服装组件" })).toBeVisible();
  });

  it("captures into the current draft, cancels late results, and restores image undo", async () => {
    const repo = repository();
    const onChange = vi.fn();
    const onBusyChange = vi.fn();
    const ref = createRef<MaterialContentCanvasHandle>();
    const image: MaterialEditImage = {
      localImageId: "captured", mimeType: "image/png", byteLength: 1,
      width: 600, height: 400, dataUrl: "data:image/png;base64,AA",
    };
    let finish!: (image: MaterialEditImage | null) => void;
    let cancelled = false;
    vi.mocked(repo.captureEditImage).mockImplementation((_id, cancellation) => {
      void cancellation.then(() => { cancelled = true; });
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<MaterialContentCanvas material={model()} assets={new Map()} sessionId="capture-session"
      repository={repo} onChange={onChange} onBusyChange={onBusyChange} onError={vi.fn()} ref={ref} />);
    fireEvent.click(await screen.findByRole("button", { name: "截图" }));
    expect(screen.getByRole("button", { name: "取消截图" })).toBeEnabled();
    expect(() => ref.current!.readPayload()).toThrow(/图片操作尚未完成/);
    fireEvent.click(screen.getByRole("button", { name: "取消截图" }));
    await waitFor(() => expect(cancelled).toBe(true));
    await act(async () => finish(image));
    expect(componentImages(ref.current!.readPayload().component)).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "截图" }));
    await act(async () => finish(image));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("captured");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(componentImages(ref.current!.readPayload().component)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("captured");
    expect(repo.importEditImages).not.toHaveBeenCalled();
    expect(repo.commitEdit).not.toHaveBeenCalled();
  });

  it("cancels an active screenshot when its canvas is unmounted", async () => {
    const repo = repository();
    let cancelled = false;
    repo.captureEditImage = vi.fn(async (_id, cancellation) => {
      await cancellation;
      cancelled = true;
      return null;
    });
    const { unmount } = render(<MaterialContentCanvas material={model()} assets={new Map()} sessionId="capture-session"
      repository={repo} onChange={vi.fn()} onBusyChange={vi.fn()} onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "截图" }));
    unmount();
    await waitFor(() => expect(cancelled).toBe(true));
  });

  it("finishes started import and opens a read-only preview when the parent mirrors canvas busy into disabled", async () => {
    const material = model();
    const repo = repository();
    const ref = createRef<MaterialContentCanvasHandle>();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    let finishImport!: (images: MaterialEditImage[]) => void;
    vi.mocked(repo.importEditImages).mockReturnValue(new Promise((resolve) => { finishImport = resolve; }));
    function ParentBusyHarness() {
      const [busy, setBusy] = useState(false);
      return <LibraryDialog title="编辑素材内容" onClose={onClose} busy={busy}>
        <MaterialContentCanvas material={material} assets={new Map()} sessionId="busy-session"
          repository={repo} disabled={busy} onBusyChange={setBusy}
          onChange={onChange} onError={onError} ref={ref} />
      </LibraryDialog>;
    }
    render(<ParentBusyHarness />);
    fireEvent.click((await screen.findAllByRole("button", { name: "添加图片" }))[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭编辑素材内容" })).toBeDisabled());
    expect(screen.getByRole("progressbar", { name: "图片加载进度" })).toBeVisible();
    expect(() => ref.current!.readPayload()).toThrow(/图片操作尚未完成/);
    const imported: MaterialEditImage = {
      localImageId: "busy-import", mimeType: "image/png", byteLength: 1,
      width: 900, height: 600, dataUrl: "data:image/png;base64,AA",
    };
    await act(async () => finishImport([imported]));
    expect(screen.queryByRole("progressbar", { name: "图片加载进度" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭编辑素材内容" })).toBeEnabled());
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("busy-import");
    fireEvent.doubleClick(await screen.findByRole("button", { name: "选择参考图 1" }));
    expect(await screen.findByRole("button", { name: "关闭图片" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /裁剪|裁切/ })).not.toBeInTheDocument();
    expect(repo.cropEditImage).not.toHaveBeenCalled();
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("busy-import");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "关闭图片" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "关闭图片" })).not.toBeInTheDocument();
    expect(repo.beginEdit).not.toHaveBeenCalled();
    expect(repo.commitEdit).not.toHaveBeenCalled();
    expect(repo.discardEdit).not.toHaveBeenCalled();
  });

  it("lets toolbar undo cancel the first focused text draft before blur", async () => {
    render(<MaterialContentCanvas material={model()} assets={new Map()} sessionId="session"
      repository={repository()} onChange={vi.fn()} onBusyChange={vi.fn()} onError={vi.fn()} />);
    const name = await screen.findByRole("textbox", { name: /模特名称/ });
    name.focus();
    fireEvent.input(name, { target: { value: "未离开输入框的修改" } });
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("textbox", { name: /模特名称/ })).toHaveValue("原模特");
  });

  it("mounts one production component, flushes focused fields, validates, and undoes without structural affordances", async () => {
    const ref = createRef<MaterialContentCanvasHandle>();
    const original = model();
    const onChange = vi.fn();
    const repo = repository();
    const props = { material: original, assets: new Map<string, string>(), sessionId: "session",
      repository: repo, onChange, onBusyChange: vi.fn(), onError: vi.fn(), ref };
    const { container, rerender } = render(<MaterialContentCanvas {...props} />);
    const name = await screen.findByRole("textbox", { name: /模特名称/ });
    expect(container.querySelectorAll(".preshot-artifact-block")).toHaveLength(1);
    const paper = container.querySelector("[data-material-canvas-document]");
    expect(paper).toContainElement(name);
    expect(paper).not.toContainElement(screen.getByRole("toolbar", { name: "素材画布工具" }));
    expect(container.querySelectorAll('[data-content-type="paragraph"]')).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /更多操作|删除组件|复制组件|添加组件|素材库/ })).not.toBeInTheDocument();
    fireEvent.change(name, { target: { value: "新模特" } });
    let saved: ReturnType<MaterialContentCanvasHandle["readPayload"]> | undefined;
    act(() => { saved = ref.current!.readPayload(); });
    expect(saved?.component).toMatchObject({ modelId: "新模特" });
    expect(onChange).toHaveBeenLastCalledWith(saved);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("textbox", { name: /模特名称/ })).toHaveValue("原模特");
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(screen.getByRole("textbox", { name: /模特名称/ })).toHaveValue("新模特");
    fireEvent.change(screen.getByRole("textbox", { name: /身高/ }), { target: { value: "999" } });
    act(() => { expect(() => ref.current!.readPayload()).toThrow(/身高/); });
    const editor = container.querySelector<HTMLElement>(".bn-editor")!;
    fireEvent.keyDown(editor, { key: "Delete" });
    fireEvent.paste(editor, { clipboardData: { getData: () => "<p>rogue</p>", files: [] } });
    fireEvent.drop(editor, { dataTransfer: { files: [], getData: () => "rogue" } });
    expect(container.querySelectorAll(".preshot-artifact-block")).toHaveLength(1);
    expect(container.querySelectorAll('[data-content-type="paragraph"]')).toHaveLength(0);
    rerender(<MaterialContentCanvas {...props} disabled />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: /模特名称/ })).toBeDisabled());
    expect(repo.beginEdit).not.toHaveBeenCalled();
    expect(repo.commitEdit).not.toHaveBeenCalled();
    expect(repo.discardEdit).not.toHaveBeenCalled();
    expect(original.payload.component).toMatchObject({ modelId: "原模特" });
  });

  it("uses session-owned imports, exposes busy state and propagates failures", async () => {
    const repo = repository();
    const onBusyChange = vi.fn();
    const onError = vi.fn();
    const ref = createRef<MaterialContentCanvasHandle>();
    vi.mocked(repo.importEditImages).mockResolvedValue([{
      localImageId: "staged-1", mimeType: "image/png", byteLength: 1,
      width: 20, height: 20, dataUrl: "data:image/png;base64,AA",
    }]);
    render(<MaterialContentCanvas material={model()} assets={new Map()} sessionId="session"
      repository={repo} onChange={vi.fn()} onBusyChange={onBusyChange} onError={onError} ref={ref} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "添加图片" }))[0]);
    await waitFor(() => expect(repo.importEditImages).toHaveBeenCalledWith("session", expect.any(Function)));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(screen.getAllByRole("img", { name: "参考图" })).toHaveLength(1);
    expect(document.querySelectorAll("[data-image-resize-edge]")).toHaveLength(8);
    vi.mocked(repo.importEditImages).mockRejectedValue(new Error("磁盘不可写"));
    fireEvent.click(screen.getByRole("button", { name: "添加图片" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("磁盘不可写")));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("previews without changing staged images, removes images, and restores native identities on undo", async () => {
    const original = model();
    const repo = repository();
    const ref = createRef<MaterialContentCanvasHandle>();
    const onBusyChange = vi.fn();
    vi.mocked(repo.importEditImages).mockResolvedValue([{
      localImageId: "staged-original", mimeType: "image/png", byteLength: 1,
      width: 900, height: 600, dataUrl: "data:image/png;base64,AA",
    }]);
    render(<MaterialContentCanvas material={original} assets={new Map()} sessionId="crop-session"
      repository={repo} onChange={vi.fn()} onBusyChange={onBusyChange} onError={vi.fn()} ref={ref} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "添加图片" }))[0]);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeEnabled());
    fireEvent.doubleClick(screen.getByRole("button", { name: "选择参考图 1" }));
    expect((await screen.findByRole("dialog")).querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AA");
    expect(screen.queryByRole("button", { name: /裁剪|裁切/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭图片" }));
    expect(repo.cropEditImage).not.toHaveBeenCalled();
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("staged-original");
    fireEvent.click(screen.getByRole("button", { name: "删除参考图 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    expect(componentImages(ref.current!.readPayload().component)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("staged-original");
    expect(original.images).toEqual([]);
  });

  it("preserves existing image-group text and keeps real dnd-kit keyboard preview out of payloads until one drop", async () => {
    const original: MaterialDetail = {
      ...model(), kind: "imageGroup", imageCount: 2,
      payload: { format: "preshot-material", version: 1, kind: "imageGroup",
        component: { kind: "imageGroup", name: "图片组", description: "说明",
          images: ["native-b", "native-a"].map((localImageId) => ({
            localImageId, aspectRatio: 1.5, frameWidth: 120, frameHeight: 80,
          })) } },
      images: ["native-b", "native-a"].map((localImageId) => ({
        localImageId, blobId: localImageId, mimeType: "image/png", byteLength: 1, width: 900, height: 600,
      })),
    };
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function(this: HTMLElement) {
        if (this.dataset.imageGroupId) return new DOMRect(0, 0, 1008, 120);
        if (this.dataset.imageId) return new DOMRect(Number(this.dataset.imageIndex) * 140 + 8, 8, 120, 80);
        return new DOMRect(0, 0, 1080, 600);
      });
    const ref = createRef<MaterialContentCanvasHandle>();
    const onChange = vi.fn();
    const result = render(<LibraryDialog title="编辑素材内容" onClose={vi.fn()}>
      <MaterialContentCanvas material={original}
        assets={new Map(original.images.map(({ localImageId }) => [localImageId, "data:image/png;base64,AA"]))}
        sessionId="drag-session" repository={repository()} onChange={onChange}
        onBusyChange={vi.fn()} onError={vi.fn()} ref={ref} />
    </LibraryDialog>);
    try {
      const first = await screen.findByRole("button", { name: "选择参考图 1" });
      expect(screen.getByRole("region", { name: "素材内容编辑画布" }).querySelector("input, textarea")).toBeNull();
      expect(ref.current!.readPayload().component).toMatchObject({ name: "图片组", description: "说明" });
      const dialog = screen.getByRole("dialog", { name: "编辑素材内容" });
      const announcement = screen.getByTestId("image-drag-announcement");
      expect(dialog).toContainElement(announcement);
      expect(announcement.closest("[inert], [aria-hidden='true']")).toBeNull();
      for (const id of first.getAttribute("aria-describedby")?.split(/\s+/) ?? []) {
        expect(dialog).toContainElement(document.getElementById(id));
      }
      first.focus();
      fireEvent.keyDown(first, { code: "Space", key: " " });
      await waitFor(() => expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent("已拿起"));
      fireEvent.keyDown(document, { code: "End", key: "End" });
      await waitFor(() => expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent("第 2 位"));
      const tokens = () => componentImages(ref.current!.readPayload().component).map(({ localImageId }) => localImageId);
      expect(tokens()).toEqual(["native-b", "native-a"]);
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyDown(document, { code: "Enter", key: "Enter" });
      await waitFor(() => expect(tokens()).toEqual(["native-a", "native-b"]));
      expect(onChange).toHaveBeenCalledOnce();
      fireEvent.keyDown(document, { code: "Enter", key: "Enter" });
      expect(onChange).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "撤销" }));
      expect(tokens()).toEqual(["native-b", "native-a"]);
      expect(original.payload.component).toMatchObject({ name: "图片组" });
    } finally {
      result.unmount();
      measure.mockRestore();
    }
  });
});
