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

  it("finishes started import and crop when the parent mirrors canvas busy into disabled", async () => {
    const material = model();
    const repo = repository();
    const ref = createRef<MaterialContentCanvasHandle>();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    let finishImport!: (images: MaterialEditImage[]) => void;
    let finishCrop!: (image: MaterialEditImage) => void;
    vi.mocked(repo.importEditImages).mockReturnValue(new Promise((resolve) => { finishImport = resolve; }));
    vi.mocked(repo.cropEditImage).mockReturnValue(new Promise((resolve) => { finishCrop = resolve; }));
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
    expect(() => ref.current!.readPayload()).toThrow(/图片操作尚未完成/);
    const imported: MaterialEditImage = {
      localImageId: "busy-import", mimeType: "image/png", byteLength: 1,
      width: 900, height: 600, dataUrl: "data:image/png;base64,AA",
    };
    await act(async () => finishImport([imported]));
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭编辑素材内容" })).toBeEnabled());
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("busy-import");
    fireEvent.doubleClick(await screen.findByRole("button", { name: "选择参考图 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "裁剪" }));
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭编辑素材内容" })).toBeDisabled());
    expect(repo.cropEditImage).toHaveBeenCalledWith(
      "busy-session", "busy-import", { x: 150, y: 0, width: 600, height: 600 },
    );
    await act(async () => finishCrop({ ...imported, localImageId: "busy-crop", width: 600 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭编辑素材内容" })).toBeEnabled());
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("busy-crop");
    expect(onChange).toHaveBeenCalledTimes(2);
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
    await waitFor(() => expect(repo.importEditImages).toHaveBeenCalledWith("session"));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(screen.getAllByRole("img", { name: "参考图" })).toHaveLength(1);
    expect(document.querySelectorAll("[data-image-resize-edge]")).toHaveLength(8);
    vi.mocked(repo.importEditImages).mockRejectedValue(new Error("磁盘不可写"));
    fireEvent.click(screen.getByRole("button", { name: "添加图片" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("磁盘不可写")));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("crops a staged copy through the real lightbox, removes images, and restores native identities on undo", async () => {
    const original = model();
    const repo = repository();
    const ref = createRef<MaterialContentCanvasHandle>();
    const onBusyChange = vi.fn();
    vi.mocked(repo.importEditImages).mockResolvedValue([{
      localImageId: "staged-original", mimeType: "image/png", byteLength: 1,
      width: 900, height: 600, dataUrl: "data:image/png;base64,AA",
    }]);
    vi.mocked(repo.cropEditImage).mockResolvedValue({
      localImageId: "staged-cropped", mimeType: "image/png", byteLength: 1,
      width: 600, height: 600, dataUrl: "data:image/png;base64,AQ",
    });
    render(<MaterialContentCanvas material={original} assets={new Map()} sessionId="crop-session"
      repository={repo} onChange={vi.fn()} onBusyChange={onBusyChange} onError={vi.fn()} ref={ref} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "添加图片" }))[0]);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择参考图 1" })).toBeEnabled());
    fireEvent.doubleClick(screen.getByRole("button", { name: "选择参考图 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "裁剪" }));
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认裁剪" }));
    await waitFor(() => expect(repo.cropEditImage).toHaveBeenCalledWith(
      "crop-session", "staged-original", { x: 150, y: 0, width: 600, height: 600 },
    ));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("staged-cropped");
    fireEvent.click(screen.getByRole("button", { name: "关闭图片" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("staged-original");
    fireEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("staged-cropped");
    fireEvent.click(screen.getByRole("button", { name: "删除参考图 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    expect(componentImages(ref.current!.readPayload().component)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(componentImages(ref.current!.readPayload().component)[0].localImageId).toBe("staged-cropped");
    expect(original.images).toEqual([]);
  });

  it("edits image-group text and keeps real dnd-kit keyboard preview out of payloads until one drop", async () => {
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
      const name = await screen.findByRole("textbox", { name: "图片组名称" });
      fireEvent.change(name, { target: { value: "新的组名" } });
      act(() => { expect(ref.current!.readPayload().component).toMatchObject({ name: "新的组名" }); });
      onChange.mockClear();
      const first = screen.getByRole("button", { name: "选择参考图 1" });
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
