// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  ImageGroupBlockContext,
  type ImageGroupBlockController,
} from "./ImageGroupBlockContext";
import {
  ImageDragPreviewProvider,
  type ImageDragPreviewController,
  useImageDragPreview,
} from "./ImageDragPreviewContext";
import { ImageGroupBlockView } from "./ImageGroupBlockView";

vi.mock("@blocknote/react", () => ({
  useBlockNoteEditor: () => ({
    getBlock: () => undefined,
  }),
}));

function group(id: string, imageId: string): ReferenceComponent {
  return {
    id,
    name: id,
    type: "reference",
    x: 0,
    width: 300,
    height: 120,
    description: "",
    images: [{
      id: imageId,
      file: `references/${imageId}.png`,
      aspectRatio: 1.5,
      frameWidth: 120,
      frameHeight: 80,
    }],
  };
}

function controllerFor(
  groups: ReferenceComponent[],
  overrides: Partial<ImageGroupBlockController> = {},
) {
  const controller: ImageGroupBlockController = {
    createGroup: () => "new-group",
    subscribe: () => () => undefined,
    cloneGroup: () => null,
    getGroup: (groupId) => groups.find((entry) => entry.id === groupId),
    getImageSrc: (file) => file,
    addImages: vi.fn(),
    removeImage: vi.fn(),
    selectImage: vi.fn(),
    openImage: vi.fn(),
    setImageFrame: vi.fn(),
    setImageFitMode: vi.fn(),
    moveImage: vi.fn(),
    ...overrides,
  };
  return controller;
}

function renderGroups(
  groups: ReferenceComponent[],
  controller: ImageGroupBlockController,
  onDragController?: (drag: ImageDragPreviewController) => void,
  imageSources: Readonly<Record<string, string>> = Object.fromEntries(
    groups.flatMap((entry) =>
      entry.images.map((image) => [image.file, image.file])),
  ),
) {
  function DragControllerCapture() {
    const drag = useImageDragPreview();
    useEffect(() => onDragController?.(drag), [drag]);
    return null;
  }
  return render(
    <ImageDragPreviewProvider
      enabled
      imageGroups={groups}
      imageSources={imageSources}
      onMoveImage={controller.moveImage}
      planRevision={1}
      projectKey="image-group-view-test"
    >
      <DragControllerCapture />
      <ImageGroupBlockContext.Provider value={controller}>
        {groups.map((entry) => (
          <ImageGroupBlockView
            blockId={`block-${entry.id}`}
            groupId={entry.id}
            key={entry.id}
          />
        ))}
      </ImageGroupBlockContext.Provider>
    </ImageDragPreviewProvider>,
  );
}

describe("ImageGroupBlockView image tile interactions", () => {
  it.each(["Escape", "blur", "unmount", "inactive"] as const)(
    "cancels an unfinished resize on %s without a late commit",
    (reason) => {
      const groups = [group("gallery", "image")];
      const controller = controllerFor(groups);
      const view = renderGroups(groups, controller);
      const handle = screen.getByLabelText("从right调整参考图 1");
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 0 });
      if (reason === "Escape") fireEvent.keyDown(handle, { key: "Escape" });
      else if (reason === "blur") fireEvent(window, new Event("blur"));
      else if (reason === "unmount") view.unmount();
      else view.container.setAttribute("inert", "");
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 0 });
      expect(controller.setImageFrame).not.toHaveBeenCalled();
    },
  );

  it("uses the releasing pointer's latest coordinates and commits only once", () => {
    const groups = [group("gallery", "image")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    fireEvent.pointerDown(screen.getByLabelText("从right调整参考图 1"), {
      button: 0, pointerId: 1, clientX: 0, clientY: 0,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 20, clientY: 0 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 0 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 90, clientY: 0 });
    expect(controller.setImageFrame).toHaveBeenCalledExactlyOnceWith("gallery", "image",
      expect.objectContaining({ frameWidth: 180, frameHeight: 80 }));
  });

  it("ignores a different pointer during an active resize", () => {
    const groups = [group("gallery", "image")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    fireEvent.pointerDown(screen.getByLabelText("从right调整参考图 1"), {
      button: 0, pointerId: 1, clientX: 0, clientY: 0,
    });
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 80, clientY: 0 });
    fireEvent.pointerUp(document, { pointerId: 2, clientX: 80, clientY: 0 });
    expect(controller.setImageFrame).not.toHaveBeenCalled();
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 40, clientY: 0 });
    expect(controller.setImageFrame).toHaveBeenCalledExactlyOnceWith("gallery", "image",
      expect.objectContaining({ frameWidth: 160, frameHeight: 80 }));
  });

  it("does not start a resize from the secondary mouse button", () => {
    const groups = [group("gallery", "image")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    fireEvent.pointerDown(screen.getByLabelText("从right调整参考图 1"), {
      button: 2, clientX: 0, clientY: 0,
    });
    fireEvent.pointerUp(document, { button: 2, clientX: 40, clientY: 0 });
    expect(controller.setImageFrame).not.toHaveBeenCalled();
  });

  it("opens one confirmation for Delete and exposes deletion outside an oversized image", () => {
    const wide = group("gallery", "wide");
    wide.images[0].frameWidth = 1440;
    const controller = controllerFor([wide], { selectedImageId: "wide" });
    renderGroups([wide], controller);
    const image = screen.getByRole("button", { name: "选择参考图 1" });
    fireEvent.keyDown(image, { key: "Delete" });
    expect(screen.getByRole("dialog", { name: "删除图片？" })).toBeVisible();
    expect(controller.removeImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "删除选中图片" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(controller.removeImage).toHaveBeenCalledExactlyOnceWith("gallery", "wide");
  });

  it.each([{ key: "Delete", repeat: true }, { key: "Delete", isComposing: true },
    { key: "Delete", ctrlKey: true }, { key: "Backspace" }])("does not treat %j as image deletion", (event) => {
    const groups = [group("gallery", "image")];
    renderGroups(groups, controllerFor(groups, { selectedImageId: "image" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "选择参考图 1" }), event);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows actual import progress only in the loading group and prevents duplicate imports", () => {
    const loading = { ...group("loading", "first"), images: [] };
    const other = group("other", "second");
    const controller = controllerFor([loading, other], {
      getImportProgress: (id) => id === "loading" ? { phase: "loading", completed: 1, total: 3 } : undefined,
    });
    renderGroups([loading, other], controller);
    const bar = screen.getByRole("progressbar", { name: "图片加载进度" });
    expect(bar).toHaveAttribute("value", "1");
    expect(bar).toHaveAttribute("max", "3");
    expect(screen.getByText("正在加载图片… 1 / 3")).toBeVisible();
    const addButtons = screen.getAllByRole("button", { name: "添加图片" });
    expect(addButtons[0]).toBeDisabled();
    expect(addButtons[1]).toBeDisabled();
    expect(addButtons[2]).toBeEnabled();
    fireEvent.click(addButtons[0]);
    expect(controller.addImages).not.toHaveBeenCalled();
  });
  it("shows a library action after a single click and saves only the currently selected image", () => {
    const images = group("collection", "first");
    images.images.push({ ...images.images[0], id: "second", file: "references/second.png" });
    const saveImage = vi.fn();
    const openImage = vi.fn();
    function SelectionFixture() {
      const [selectedImageId, selectImage] = useState<string | null>(null);
      const controller = controllerFor([images], { selectedImageId, selectImage, saveImage, openImage });
      return <ImageDragPreviewProvider enabled imageGroups={[images]} imageSources={{}} onMoveImage={controller.moveImage} planRevision={1} projectKey="selection-test">
        <ImageGroupBlockContext.Provider value={controller}>
          <ImageGroupBlockView blockId="owner" groupId={images.id} />
        </ImageGroupBlockContext.Provider>
      </ImageDragPreviewProvider>;
    }
    render(<SelectionFixture />);
    expect(screen.queryByRole("button", { name: "添加到素材库" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择参考图 1" }));
    expect(screen.getByRole("button", { name: "添加到素材库" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "选择参考图 2" }));
    fireEvent.click(screen.getByRole("button", { name: "添加到素材库" }));
    expect(saveImage).toHaveBeenCalledExactlyOnceWith("collection", "second");
    expect(openImage).not.toHaveBeenCalled();
  });
  it("saves the selected tile separately from its group", () => {
    const groups = [group("collection", "selected-image")];
    const saveImage = vi.fn();
    renderGroups(groups, controllerFor(groups, { saveImage }));
    fireEvent.click(screen.getByRole("button", { name: "保存参考图 1 到素材库" }));
    expect(saveImage).toHaveBeenCalledExactlyOnceWith("collection", "selected-image");
  });

  it("disables adding a second image in an image material", () => {
    const groups = [group("collection", "selected-image")];
    renderGroups(groups, controllerFor(groups, { singleImage: true, captureImage: vi.fn() }));
    expect(screen.getByRole("button", { name: "添加图片" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "截图" })).toBeDisabled();
  });
  it("locks outer block actions while preserving internal image controls", () => {
    const groups = [group("locked", "image")];
    const controller = controllerFor(groups, {
      structureEditable: false, removeBlock: vi.fn(), saveBlock: vi.fn(),
    });
    renderGroups(groups, controller);
    expect(screen.queryByRole("button", { name: "删除图片组" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存图片组到素材库" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("拖动图片组")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-image-resize-edge]")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "添加图片" }));
    expect(controller.addImages).toHaveBeenCalledWith("locked", 282);
  });
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the whole top-level image group through its block identity", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups, { saveBlock: vi.fn() });
    renderGroups(groups, controller);
    fireEvent.click(screen.getByRole("button", { name: "保存图片组到素材库" }));
    expect(controller.saveBlock).toHaveBeenCalledWith("block-group-1");
  });

  it("selects on click and opens the viewer only on body double click", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups, { selectedImageId: "image-1" });
    renderGroups(groups, controller);
    const tile = screen.getByRole("button", { name: "选择参考图 1" });

    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(tile).toHaveAttribute("data-image-clipboard-id", "image-1");
    expect(tile).toHaveAttribute("data-image-group-id", "group-1");
    expect(tile.closest("[data-clipboard-gallery]")).toHaveAttribute("data-clipboard-gallery", "group-1");
    expect(screen.getByRole("heading", { name: "图片组" }).closest("[data-clipboard-gallery]"))
      .toContainElement(tile);
    expect(tile.querySelector("img")).not.toHaveAttribute("data-image-clipboard-id");
    expect(document.querySelectorAll("[data-image-resize-edge]")).toHaveLength(8);
    fireEvent.click(tile);
    expect(controller.selectImage).toHaveBeenCalledWith("image-1");
    expect(controller.openImage).not.toHaveBeenCalled();

    fireEvent.doubleClick(tile);
    expect(controller.openImage).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      "references/image-1.png",
    );
  });

  it("keeps the gallery paste destination available when empty", () => {
    const empty = { ...group("empty", "unused"), images: [] };
    renderGroups([empty], controllerFor([empty]));
    expect(document.querySelector("[data-clipboard-gallery-empty]")?.closest("[data-clipboard-gallery]"))
      .toHaveAttribute("data-clipboard-gallery", "empty");
  });

  it("keeps editor mousedown from reclaiming tile focus without cancelling native button defaults", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    const tile = screen.getByRole("button", { name: "选择参考图 1" });
    const gallery = tile.closest<HTMLElement>("[data-clipboard-gallery]")!;
    gallery.tabIndex = -1;
    const editorMouseDown = vi.fn(() => gallery.focus());
    gallery.addEventListener("mousedown", editorMouseDown);

    act(() => tile.focus());
    expect(fireEvent.mouseDown(tile, { button: 0 })).toBe(true);
    expect(tile).toHaveFocus();
    expect(editorMouseDown).not.toHaveBeenCalled();
    fireEvent.mouseUp(tile);
    fireEvent.click(tile);
    expect(controller.selectImage).toHaveBeenCalledWith("image-1");
    expect(controller.openImage).not.toHaveBeenCalled();
  });

  it("renders only internal image resize zones and isolates their interaction", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);

    expect(
      Array.from(document.querySelectorAll("[data-image-resize-edge]"))
        .map((element) => element.getAttribute("data-image-resize-edge")),
    ).toEqual([
      "left",
      "right",
      "top",
      "bottom",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
    expect(
      Array.from(document.querySelectorAll("[data-group-resize-edge]"))
        .map((element) => element.getAttribute("data-group-resize-edge")),
    ).toEqual([]);

    fireEvent.pointerDown(screen.getByLabelText("从left调整参考图 1"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerUp(document, { clientX: 0, clientY: 0 });

    expect(controller.selectImage).not.toHaveBeenCalled();
    expect(controller.moveImage).not.toHaveBeenCalled();
    expect(controller.openImage).not.toHaveBeenCalled();
    const topZone = screen.getByLabelText("从top调整参考图 1");
    expect(topZone).toHaveStyle({
      background: "transparent",
      cursor: "ns-resize",
    });
    expect(getComputedStyle(topZone).borderTopWidth).toBe("0px");
  });

  it("keeps resize, delete, toolbar, and whole-group drag outside image drag", async () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    let drag: ImageDragPreviewController | null = null;
    renderGroups(groups, controller, (next) => { drag = next; });
    await waitFor(() => expect(drag).not.toBeNull());

    fireEvent.pointerDown(screen.getByLabelText("从right调整参考图 1"), {
      button: 0,
      clientX: 10,
      clientY: 10,
    });

    fireEvent.pointerCancel(document);
    fireEvent.pointerDown(screen.getByLabelText("删除参考图 1"), {
      button: 0,
    });
    fireEvent.pointerDown(screen.getByRole("button", { name: "添加图片" }), {
      button: 0,
    });
    fireEvent.pointerDown(screen.getByText("图片组", { exact: true }), {
      button: 0,
    });

    expect(drag!.state.status).toBe("idle");
    expect(controller.moveImage).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "选择参考图 1" }),
    ).toHaveAttribute("data-image-drag-activator", "true");
    expect(screen.getByLabelText("删除参考图 1"))
      .not.toHaveAttribute("data-image-drag-activator");
    expect(screen.getByLabelText("从right调整参考图 1"))
      .not.toHaveAttribute("data-image-drag-activator");
  });

  it("explicitly toggles between crop and stretch rendering", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);

    fireEvent.click(screen.getByRole("button", {
      name: "切换参考图 1 为自由变形",
    }));
    expect(controller.setImageFitMode).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      "stretch",
    );
  });

  it("resizes transparent zones with keyboard axis rules", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);

    fireEvent.keyDown(screen.getByLabelText("从bottom调整参考图 1"), {
      key: "ArrowDown",
    });
    expect(controller.setImageFrame).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      expect.objectContaining({
        frameWidth: 120,
        frameHeight: 84,
      }),
    );

    vi.mocked(controller.setImageFrame).mockClear();
    fireEvent.keyDown(screen.getByLabelText("从bottom-right调整参考图 1"), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(controller.setImageFrame).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      expect.objectContaining({
        frameWidth: 136,
        frameHeight: 136 / 1.5,
      }),
    );
  });

  it("keeps an undecoded image selected and geometrically stable while disabling drag", async () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups, {
      getImageSrc: () => undefined,
      selectedImageId: "image-1",
    });
    let drag: ImageDragPreviewController | null = null;
    renderGroups(groups, controller, (next) => { drag = next; }, {});
    await waitFor(() => expect(drag).not.toBeNull());
    const tile = screen.getByRole("button", { name: "选择参考图 1" });
    const frame = document.querySelector<HTMLElement>(
      '[data-image-id="image-1"]',
    )!;

    expect(tile).toHaveAttribute("aria-disabled", "true");
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(frame).toHaveStyle({ width: "120px", height: "80px" });
    fireEvent.click(tile);
    expect(controller.selectImage).toHaveBeenCalledWith("image-1");
    fireEvent.pointerDown(tile, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 12,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 30,
      clientY: 10,
      isPrimary: true,
      pointerId: 12,
      pointerType: "mouse",
    });
    expect(drag!.state.status).toBe("idle");
    expect(screen.getByText("加载中…")).toBeVisible();
  });

  it("live-previews and coherently commits image and group geometry", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    const handle = screen.getByLabelText("从right调整参考图 1");
    const groupElement = document.querySelector<HTMLElement>(
      '[data-image-group-id="group-1"]',
    )!;

    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 40, clientY: 0 });

    expect(Number.parseFloat(groupElement.style.height)).toBeCloseTo(
      98,
    );

    fireEvent.pointerUp(document, { clientX: 40, clientY: 0 });
    expect(controller.setImageFrame).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      expect.objectContaining({
        frameWidth: 160,
      }),
    );
    const committed = vi.mocked(controller.setImageFrame).mock.calls[0]?.[2];
    expect(committed?.frameHeight).toBe(80);
    expect(committed?.groupHeight).toBe(98);
  });

  it("restores the content-driven layout when image resize is cancelled", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    const groupElement = document.querySelector<HTMLElement>(
      '[data-image-group-id="group-1"]',
    )!;

    fireEvent.pointerDown(screen.getByLabelText("从right调整参考图 1"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(document, { clientX: 40, clientY: 0 });
    fireEvent.pointerCancel(document);

    expect(groupElement).toHaveStyle({ height: "98px" });
    expect(controller.setImageFrame).not.toHaveBeenCalled();
  });

  it("preserves authoritative image sizes, wraps immediately, and grows height", () => {
    const source = {
      ...group("group-1", "image-1"),
      height: 80,
      images: [
        {
          id: "image-1",
          file: "references/image-1.png",
          aspectRatio: 2,
          frameWidth: 200,
          frameHeight: 100,
        },
        {
          id: "image-2",
          file: "references/image-2.png",
          aspectRatio: 2,
          frameWidth: 200,
          frameHeight: 100,
        },
      ],
    };
    renderGroups([source], controllerFor([source]));

    const frames = Array.from(
      document.querySelectorAll<HTMLElement>("[data-image-id]"),
    );
    expect(frames.map((frame) => ({
      id: frame.dataset.imageId,
      left: frame.style.left,
      top: frame.style.top,
      width: frame.style.width,
      height: frame.style.height,
    }))).toEqual([
      { id: "image-1", left: "0px", top: "0px", width: "200px", height: "100px" },
      { id: "image-2", left: "0px", top: "107px", width: "200px", height: "100px" },
    ]);
    expect(document.querySelector<HTMLElement>(
      '[data-image-group-id="group-1"]',
    )).toHaveStyle({ height: "225px" });
    for (const frame of frames) {
      expect(frame).toHaveClass("preshot-image-drag-tile");
      expect(frame.style.transition).toBe(
        "transform 200ms ease-out, opacity 200ms ease-out",
      );
      expect(frame.style.transition).not.toMatch(
        /\b(?:left|top|width|height)\b/,
      );
    }
  });

  it("clips a legacy wide image on a safe single overflow row without resizing it", () => {
    const source = {
      ...group("group-1", "wide"),
      height: 80,
      images: [
        {
          id: "wide",
          file: "references/wide.png",
          aspectRatio: 2,
          frameWidth: 400,
          frameHeight: 200,
        },
        {
          id: "next",
          file: "references/next.png",
          aspectRatio: 1,
          frameWidth: 80,
          frameHeight: 80,
        },
      ],
    };
    renderGroups([source], controllerFor([source]));

    const frames = Array.from(
      document.querySelectorAll<HTMLElement>("[data-image-id]"),
    );
    expect(frames[0]).toHaveStyle({
      left: "0px",
      top: "0px",
      width: "400px",
      height: "200px",
    });
    expect(frames[1]).toHaveStyle({ left: "0px", top: "207px" });
    expect(frames[0]?.parentElement).toHaveClass("overflow-hidden");
  });

  it("renders same-group projected order and placeholders before one commit", async () => {
    const source = {
      ...group("group-1", "image-1"),
      images: [
        group("unused", "image-1").images[0]!,
        group("unused", "image-2").images[0]!,
        group("unused", "image-3").images[0]!,
      ],
    };
    const controller = controllerFor([source]);
    let drag: ImageDragPreviewController | null = null;
    renderGroups([source], controller, (next) => { drag = next; });
    await waitFor(() => expect(drag).not.toBeNull());

    act(() => {
      drag!.start({
        activeImageId: "image-1",
        sourceGroupId: "group-1",
        sourceIndex: 0,
      });
      drag!.project({ groupId: "group-1", index: 3 });
    });
    await waitFor(() =>
      expect(drag!.state.target).toEqual({ groupId: "group-1", index: 3 }));

    expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-image-id]"))
        .map((entry) => entry.dataset.imageId),
    ).toEqual(["image-2", "image-3"]);
    expect(document.querySelector(
      '[data-image-placeholder-id="image-1"]',
    )).toHaveAttribute("data-image-drag-target-insertion", "true");
    expect(document.querySelectorAll(
      "[data-image-drag-source-placeholder]",
    )).toHaveLength(1);
    expect(controller.moveImage).not.toHaveBeenCalled();

    act(() => drag!.commit());
    expect(controller.moveImage).toHaveBeenCalledTimes(1);
    expect(controller.moveImage).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      "group-1",
      2,
    );
  });

  it("projects a cross-group move into an empty target before commit", async () => {
    const groups = [
      group("group-1", "image-1"),
      { ...group("group-2", "unused"), images: [] },
    ];
    const controller = controllerFor(groups);
    let drag: ImageDragPreviewController | null = null;
    renderGroups(groups, controller, (next) => { drag = next; });
    await waitFor(() => expect(drag).not.toBeNull());

    act(() => {
      drag!.start({
        activeImageId: "image-1",
        sourceGroupId: "group-1",
        sourceIndex: 0,
      });
      drag!.project({ groupId: "group-2", index: 0 });
    });
    await waitFor(() =>
      expect(drag!.state.target).toEqual({ groupId: "group-2", index: 0 }));

    const target = document.querySelector<HTMLElement>(
      '[data-image-group-id="group-2"]',
    )!;
    expect(target).toHaveAttribute("data-image-drag-target", "true");
    expect(target.querySelector("[data-image-drag-empty-slot]"))
      .toHaveAttribute("data-image-drag-empty-slot", "active");
    expect(target.querySelector('[data-image-placeholder-id="image-1"]'))
      .toHaveAttribute("data-image-drag-target-insertion", "true");
    expect(controller.moveImage).not.toHaveBeenCalled();

    act(() => drag!.commit());
    expect(controller.moveImage).toHaveBeenCalledTimes(1);
    expect(controller.moveImage).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      "group-2",
      0,
    );
  });
});
