// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../app/theme/ThemeProvider";
import type { MaterialDetail } from "../../../domain/library/models";
import { selectMaterialImages } from "../../../domain/library";
import type { MaterialLibraryRepository } from "../../../domain/library/ports";
import type { BlockNotePlanService } from "../../../domain/plan/blocknote/service";
import {
  createEmptyProjectPlanV15,
  type ProjectPlanV15,
} from "../../../domain/plan/canvas/blockDocument";
import { unavailableMaterialLibrary } from "../../../infrastructure/library/unavailableMaterialLibrary";
import { useOptionalMaterialLibrary } from "../../library/MaterialLibraryContext";
import { MaterialLibraryProvider } from "../../library/MaterialLibraryProvider";
import { BlockNoteProjectCanvasProvider } from "./BlockNoteProjectCanvasProvider";
import type { PreshotBlockNoteEditor } from "./blockOperations";

const material: MaterialDetail = {
  id: "6d59c50c-f08a-4149-a636-de8bcd2b1c68",
  kind: "prop",
  name: "玻璃杯道具",
  description: "逆光静物",
  tags: ["玻璃"],
  favorite: false,
  revision: 1,
  metadataVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  imageCount: 0,
  byteLength: 0,
  previewState: "pending",
  payload: {
    format: "preshot-material",
    version: 1,
    kind: "prop",
    component: {
      kind: "prop",
      title: "玻璃杯",
      source: "自备",
      gallery: { images: [] },
    },
  },
  images: [],
};
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ/8AAAAASUVORK5CYII=";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function LibraryLauncher() {
  const library = useOptionalMaterialLibrary();
  return <button type="button" onClick={() => library?.openBrowser()}>素材库</button>;
}

function fixture(initial?: ProjectPlanV15, savedMaterial = material) {
  let plan = initial ?? createEmptyProjectPlanV15("目标项目", { makeId: () => "initial" });
  const events: string[] = [];
  const repository: MaterialLibraryRepository = {
    ...unavailableMaterialLibrary,
    availability: "test",
    search: vi.fn<MaterialLibraryRepository["search"]>(async () => ({ items: [savedMaterial], total: 1, indexState: "ready" })),
    get: vi.fn(async () => structuredClone(savedMaterial)),
    loadPreview: vi.fn(async () => null),
    loadImage: vi.fn(async () => pixel),
    save: vi.fn(async (input) => ({
      ...structuredClone(material),
      ...input.metadata,
      payload: input.snapshot.payload,
    })),
    prepareInsert: vi.fn(async (input) => {
      events.push("prepare");
      expect(input.expectedPlan).toEqual(plan);
      return {
        operationId: input.operationId,
        materialId: input.materialId,
        revision: input.revision,
        payload: selectMaterialImages(savedMaterial.payload, input.selection),
        ...(input.selection ? { selection: input.selection } : {}),
        ...(input.targetGroupId ? { targetGroupId: input.targetGroupId } : {}),
        images: savedMaterial.images.filter((image) => !input.selection || input.selection.imageIds.includes(image.localImageId)).map((image, index) => ({
          localImageId: image.localImageId,
          file: `${!input.targetGroupId && (savedMaterial.kind === "image" || input.selection?.mode === "images") ? "media" : "references"}/${String(index + 1).padStart(4, "0")}.png`,
        })),
      };
    }),
    commitInsert: vi.fn(async (input) => {
      events.push("commit");
      plan = input.nextPlan;
    }),
    abortInsert: vi.fn(async () => undefined),
    getInsertStatus: vi.fn<MaterialLibraryRepository["getInsertStatus"]>(async () => "prepared"),
  };
  const service: BlockNotePlanService = {
    loadPlan: vi.fn<BlockNotePlanService["loadPlan"]>(async () => ({ status: "loaded", plan })),
    savePlan: vi.fn(async (_path, next) => { events.push("save"); plan = next; }),
    loadImage: vi.fn(async () => { events.push("load-image"); return pixel; }),
    loadMedia: vi.fn(async () => { events.push("load-media"); return pixel; }),
    importMedia: vi.fn(),
    importImages: vi.fn(),
    commitImageCrop: vi.fn(),
    removeImage: vi.fn(),
    removeGroup: vi.fn(),
    purgeDetachedGroups: vi.fn(async () => undefined),
    purgeDetachedMedia: vi.fn(async () => undefined),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  vi.stubEnv("VITE_WORKSPACE_ADAPTER", "memory");
  const view = render(
    <ThemeProvider repository={{
      read: vi.fn(async () => ({ theme: "light" as const })),
      write: vi.fn(async () => undefined),
    }}>
      <MaterialLibraryProvider repository={repository}>
        <LibraryLauncher />
        <BlockNoteProjectCanvasProvider
          projectId="target-project"
          projectName="目标项目"
          projectPath="C:\library-provider-fixture"
          logger={logger}
          service={service}
          picker={{ pickImageFile: vi.fn(), pickImageFiles: vi.fn() }}
          exporter={{ implementation: "react-pdf", export: vi.fn() }}
          saver={{ save: vi.fn() }}
          docxExporter={{ implementation: "blocknote-docx", export: vi.fn() }}
          docxSaver={{ save: vi.fn() }}
          longImageExporter={{ export: vi.fn() }}
          longImageSaver={{ save: vi.fn() }}
          projectDirectoryRevealer={{ revealProjectDirectory: vi.fn() }}
        />
      </MaterialLibraryProvider>
    </ThemeProvider>,
  );
  return { ...view, repository, service, events, logger, getPlan: () => plan };
}

function currentEditor(): PreshotBlockNoteEditor {
  const editor = (window as typeof window & {
    __PRESHOT_BLOCKNOTE_EDITOR__?: PreshotBlockNoteEditor;
  }).__PRESHOT_BLOCKNOTE_EDITOR__;
  if (!editor) throw new Error("The real editor is not mounted");
  return editor;
}

async function chooseMaterial() {
  const user = userEvent.setup();
  await screen.findByRole("group", { name: "方案正文" });
  await waitFor(() => expect(currentEditor()).toBeDefined());
  await user.click(screen.getByRole("button", { name: "素材库" }));
  const names = await screen.findAllByText("玻璃杯道具");
  await user.click(names[0]);
  const dialog = screen.getByRole("dialog");
  const insert = within(dialog).getByRole("button", { name: /^插入/ });
  await waitFor(() => expect(insert).toBeEnabled());
  await user.click(insert);
}

describe("material library and the real project editor", () => {
  it.each(["image", "imageGroup"] as const)("appends %s materials to the chosen group and undoes the batch", async (kind) => {
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 1; naturalHeight = 1; decode = async () => undefined; });
    const ids = kind === "image" ? ["first"] : ["first", "middle", "last"];
    const savedMaterial: MaterialDetail = { ...material, kind, imageCount: ids.length, byteLength: 68 * ids.length,
      payload: { format: "preshot-material", version: 1, kind, component: { kind, name: "素材图片", description: "原素材",
        images: ids.map((localImageId) => ({ localImageId, caption: localImageId, aspectRatio: 1, frameWidth: 120, frameHeight: 120 })) } },
      images: ids.map((localImageId) => ({ localImageId, blobId: "a".repeat(64), mimeType: "image/png", byteLength: 68, width: 1, height: 1 })),
    };
    const initial = createEmptyProjectPlanV15("目标项目", { makeId: () => "initial" });
    initial.imageGroups = [{ id: "target", type: "reference", name: "目标组名", description: "目标描述", x: 0, width: 1008, height: 320,
      images: [{ id: "existing", file: "references/0099.png", aspectRatio: 1, sourceWidth: 1, sourceHeight: 1, frameWidth: 120, frameHeight: 120 }] }];
    initial.document.blocks.push({ id: "target-block", type: "imageGroup", props: { groupId: "target" }, content: undefined, children: [] });
    const context = fixture(initial, savedMaterial);
    await screen.findByRole("group", { name: "方案正文" });
    fireEvent.click(await screen.findByRole("button", { name: "从素材库插入" }));
    const browser = await screen.findByRole("dialog", { name: "素材库" });
    const insert = within(browser).getByRole("button", { name: "插入到当前图片组" });
    await waitFor(() => expect(insert).toBeEnabled());
    expect(context.repository.search).toHaveBeenCalledWith(expect.objectContaining({ imagesOnly: true }));
    expect(within(browser).queryByRole("button", { name: "道具与服装" })).not.toBeInTheDocument();
    fireEvent.click(insert);
    if (kind === "imageGroup") {
      const chooser = await screen.findByRole("dialog", { name: "插入图片组素材" });
      expect(within(chooser).queryByRole("radio")).not.toBeInTheDocument();
      fireEvent.click(within(chooser).getByRole("checkbox", { name: "选择第 2 张图片：middle" }));
      fireEvent.click(within(chooser).getByRole("button", { name: "确认插入" }));
    }
    await waitFor(() => expect(context.repository.commitInsert).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "素材库" })).not.toBeInTheDocument());
    expect(context.repository.prepareInsert).toHaveBeenCalledWith(expect.objectContaining({ targetGroupId: "target" }));
    const next = context.getPlan();
    expect(next.document.blocks.map((block) => block.id)).toEqual(initial.document.blocks.map((block) => block.id));
    expect(next.imageGroups[0]).toMatchObject({ name: "目标组名", description: "目标描述" });
    expect(next.imageGroups[0].images.slice(1).map((image) => image.caption)).toEqual(kind === "image" ? ["first"] : ["first", "last"]);
    act(() => { currentEditor().undo(); });
    await act(async () => { fireEvent.keyDown(window, { key: "s", ctrlKey: true }); });
    expect(context.getPlan().imageGroups[0].images).toEqual(initial.imageGroups[0].images);
    act(() => { currentEditor().redo(); });
    await act(async () => { fireEvent.keyDown(window, { key: "s", ctrlKey: true }); });
    expect(context.getPlan().imageGroups[0].images).toEqual(next.imageGroups[0].images);
  });

  it.each(["imageGroup", "images"] as const)("inserts selected group images as %s with one commit and one undo", async (mode) => {
    const groupMaterial: MaterialDetail = {
      ...material, kind: "imageGroup", imageCount: 3, byteLength: 204,
      payload: { format: "preshot-material", version: 1, kind: "imageGroup", component: {
        kind: "imageGroup", name: "完整组名", description: "完整描述", images: ["first", "second", "third"].map((id) => ({
          localImageId: id, caption: id, aspectRatio: 1, frameWidth: 120, frameHeight: 120,
        })),
      } },
      images: ["first", "second", "third"].map((localImageId) => ({ localImageId, blobId: "a".repeat(64), mimeType: "image/png", byteLength: 68, width: 1, height: 1 })),
    };
    const context = fixture(undefined, groupMaterial);
    await screen.findByRole("group", { name: "方案正文" });
    await waitFor(() => expect(currentEditor()).toBeDefined());
    act(() => { currentEditor().setTextCursorPosition("initial", "end"); currentEditor().focus(); });
    await chooseMaterial();
    const dialog = await screen.findByRole("dialog", { name: "插入图片组素材" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "选择第 2 张图片：second" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: mode === "images" ? "独立图片" : "图片组" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认插入" }));
    await waitFor(() => expect(context.repository.commitInsert).toHaveBeenCalledOnce());
    expect(context.repository.prepareInsert).toHaveBeenCalledWith(expect.objectContaining({ selection: { mode, imageIds: ["first", "third"] } }));
    const next = context.getPlan();
    if (mode === "images") {
      expect(next.document.blocks.slice(1).map((block) => [block.type, block.props.caption])).toEqual([["image", "first"], ["image", "third"]]);
      expect(next.imageGroups).toEqual([]);
    } else {
      expect(next.imageGroups[0]).toMatchObject({ name: "完整组名", description: "完整描述" });
      expect(next.imageGroups[0].images.map((image) => image.caption)).toEqual(["first", "third"]);
    }
    const editor = currentEditor();
    act(() => { editor.undo(); });
    expect(editor.document).toHaveLength(1);
    act(() => { editor.redo(); });
    expect(editor.document.filter((block) => block.type === (mode === "images" ? "image" : "imageGroup"))).toHaveLength(mode === "images" ? 2 : 1);
    await act(async () => { fireEvent.keyDown(window, { key: "s", ctrlKey: true }); });
    expect(JSON.stringify(context.getPlan())).not.toContain("data:image");
    expect(context.repository.abortInsert).not.toHaveBeenCalled();
  });

  it("inserts an image material as a native image with independent media and real undo/redo", async () => {
    const imageMaterial: MaterialDetail = {
      ...material, kind: "image", imageCount: 1, byteLength: 68,
      payload: { format: "preshot-material", version: 1, kind: "image", component: {
        kind: "image", name: "独立照片", description: "", images: [{
          localImageId: "photo", caption: "图片说明", aspectRatio: 1, frameWidth: 120, frameHeight: 120,
        }],
      } },
      images: [{ localImageId: "photo", blobId: "a".repeat(64), mimeType: "image/png", byteLength: 68, width: 1, height: 1 }],
    };
    const context = fixture(undefined, imageMaterial);
    await screen.findByRole("group", { name: "方案正文" });
    await waitFor(() => expect(currentEditor().getBlock("initial")).toBeDefined());
    act(() => { currentEditor().setTextCursorPosition("initial", "end"); currentEditor().focus(); });
    await chooseMaterial();
    await waitFor(() => expect(context.repository.commitInsert).toHaveBeenCalledOnce());
    const inserted = context.getPlan().document.blocks[1];
    expect(inserted).toMatchObject({ type: "image", props: { url: "media/0001.png", caption: "图片说明" } });
    expect(context.getPlan().imageGroups).toEqual([]);
    expect(context.service.loadMedia).toHaveBeenCalledWith("C:\\library-provider-fixture", "media/0001.png", undefined);
    expect(context.events.indexOf("load-media")).toBeLessThan(context.events.indexOf("commit"));
    const editor = currentEditor();
    expect(editor.getBlock(inserted.id)).toMatchObject({ type: "image", props: { url: pixel } });
    act(() => { editor.undo(); });
    expect(editor.getBlock(inserted.id)).toBeUndefined();
    act(() => { editor.redo(); });
    expect(editor.getBlock(inserted.id)).toMatchObject({ type: "image", props: { url: pixel } });
    await act(async () => { fireEvent.keyDown(window, { key: "s", ctrlKey: true }); });
    expect(context.getPlan().document.blocks[1].props.url).toBe("media/0001.png");
  });

  it.each([null, "middle"])("opens the shared library with insertion at %s or the document beginning", async (anchor) => {
    const initial = createEmptyProjectPlanV15("目标项目", { makeId: () => "first" });
    initial.document.blocks = ["first", "middle", "last"].map((id) => ({
      id, type: "paragraph", props: {},
      content: [{ type: "text", text: id, styles: {} }], children: [],
    }));
    const context = fixture(initial);
    await screen.findByRole("group", { name: "方案正文" });
    expect(screen.queryByRole("button", { name: "插入素材" })).not.toBeInTheDocument();
    if (anchor) {
      act(() => { currentEditor().setTextCursorPosition(anchor, "end"); currentEditor().focus(); });
      screen.getByRole("button", { name: "素材库" }).focus();
    }
    await chooseMaterial();
    await waitFor(() => expect(context.repository.commitInsert).toHaveBeenCalledOnce());
    const inserted = context.getPlan().document.blocks.find((block) => block.type === "prop")!.id;
    expect(context.getPlan().document.blocks.map((block) => block.id)).toEqual(anchor
      ? ["first", "middle", inserted, "last"] : [inserted, "first", "middle", "last"]);
    expect(initial.document.blocks.map((block) => block.id)).toEqual(["first", "middle", "last"]);
  });

  it("does not let a modal save shortcut write the background project", async () => {
    const context = fixture();
    await screen.findByRole("group", { name: "方案正文" });
    const editor = currentEditor();
    act(() => { editor.updateBlock(editor.document[0], { type: "paragraph", content: "项目中尚未保存的修改" }); });
    fireEvent.click(screen.getByRole("button", { name: "素材库" }));
    const search = await screen.findByRole("searchbox");
    await act(async () => { fireEvent.keyDown(search, { key: "s", ctrlKey: true }); });
    expect(context.service.savePlan).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { fireEvent.keyDown(window, { key: "s", ctrlKey: true }); });
    expect(context.service.savePlan).toHaveBeenCalledOnce();
  });

  it("saves committed card text and source identity with the expected project plan", async () => {
    const initial = createEmptyProjectPlanV15("目标项目", { makeId: () => "initial" });
    initial.artifacts = [{
      id: "source-prop",
      kind: "prop",
      revision: 0,
      title: "玻璃杯",
      source: "自备",
      gallery: { id: "source-gallery", images: [] },
    }];
    initial.document.blocks.push({
      id: "source-block",
      type: "prop",
      props: { artifactId: "source-prop" },
      content: undefined,
      children: [],
    });
    const context = fixture(initial);
    const title = await screen.findByDisplayValue("玻璃杯");
    fireEvent.change(title, { target: { value: "氛围玻璃杯" } });
    fireEvent.blur(title);
    fireEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "保存到素材库" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/素材名称/), {
      target: { value: "晚间静物道具" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^保存/ }));
    await waitFor(() => expect(context.repository.save).toHaveBeenCalledOnce());
    const input = vi.mocked(context.repository.save).mock.calls[0][0];
    expect(input.projectId).toBe("target-project");
    expect(input.expectedPlan).toEqual(context.getPlan());
    expect(input.snapshot.sourceBlockId).toBe("source-block");
    expect(input.snapshot.payload.component).toMatchObject({ kind: "prop", title: "氛围玻璃杯" });
    expect(input.metadata.name).toBe("晚间静物道具");
    expect(context.events).toContain("save");
  });

  it("publishes only after native commit and keeps insertion undo/redo separate from preceding edits", async () => {
    const context = fixture();
    await screen.findByRole("group", { name: "方案正文" });
    await waitFor(() => expect(currentEditor().getBlock("initial")).toBeDefined());
    const editor = currentEditor();
    act(() => { editor.updateBlock("initial", { content: "保留之前的文字" }); });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const commit = vi.mocked(context.repository.commitInsert).getMockImplementation()!;
    vi.mocked(context.repository.commitInsert).mockImplementationOnce(async (input) => {
      await gate;
      await commit(input);
    });
    await chooseMaterial();
    await waitFor(() => expect(context.repository.commitInsert).toHaveBeenCalledOnce());
    expect(screen.queryByDisplayValue("玻璃杯")).not.toBeInTheDocument();
    expect(context.events).toEqual(["save", "prepare"]);
    await act(async () => { release(); await gate; });
    expect(await screen.findByDisplayValue("玻璃杯")).toBeVisible();
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    const inserted = context.getPlan().artifacts[0];
    expect(inserted.id).not.toBe(material.id);
    expect(context.getPlan().document.blocks.some((block) => block.props.artifactId === inserted.id)).toBe(true);
    act(() => { expect(editor.undo()).toBe(true); });
    expect(screen.queryByDisplayValue("玻璃杯")).not.toBeInTheDocument();
    expect(screen.getByText("保留之前的文字")).toBeVisible();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(context.getPlan().artifacts).toHaveLength(0));
    act(() => { expect(editor.redo()).toBe(true); });
    expect(await screen.findByDisplayValue("玻璃杯")).toBeVisible();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(context.getPlan().artifacts[0]?.id).toBe(inserted.id));
    expect(context.repository.prepareInsert).toHaveBeenCalledOnce();
  });

  it("blocks saves and retirement purges when commit status is unknown", async () => {
    const context = fixture();
    vi.mocked(context.repository.commitInsert).mockRejectedValue(new Error("response lost"));
    vi.mocked(context.repository.getInsertStatus).mockRejectedValue(new Error("status unavailable"));
    await chooseMaterial();
    await waitFor(() => expect(context.repository.getInsertStatus).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId("canvas-scroller")).toHaveAttribute("inert"));
    const saves = vi.mocked(context.service.savePlan).mock.calls.length;
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await act(async () => { context.unmount(); });
    expect(context.service.savePlan).toHaveBeenCalledTimes(saves);
    expect(context.service.purgeDetachedGroups).not.toHaveBeenCalled();
    expect(context.service.purgeDetachedMedia).not.toHaveBeenCalled();
    expect(context.repository.abortInsert).not.toHaveBeenCalled();
  });

  it("loads the new project-owned image before publishing the inserted card", async () => {
    const imageMaterial: MaterialDetail = {
      ...material,
      imageCount: 1,
      byteLength: 68,
      payload: {
        ...material.payload,
        component: {
          kind: "prop", title: "玻璃杯", source: "自备",
          gallery: { images: [{
            localImageId: "local-image",
            aspectRatio: 1,
            frameWidth: 120,
            frameHeight: 120,
            sourceWidth: 1,
            sourceHeight: 1,
          }] },
        },
      },
      images: [{
        localImageId: "local-image",
        blobId: "a".repeat(64),
        mimeType: "image/png",
        byteLength: 68,
        width: 1,
        height: 1,
      }],
    };
    const context = fixture(undefined, imageMaterial);
    await chooseMaterial();
    expect(await screen.findByDisplayValue("玻璃杯")).toBeVisible();
    const tile = await screen.findByRole("button", { name: "选择参考图 1" });
    expect(tile.querySelector("img")).toHaveAttribute("src", pixel);
    expect(context.service.loadImage).toHaveBeenCalledWith("C:\\library-provider-fixture", "references/0001.png", undefined);
    expect(context.events.indexOf("load-image")).toBeLessThan(context.events.indexOf("commit"));
  });
});
