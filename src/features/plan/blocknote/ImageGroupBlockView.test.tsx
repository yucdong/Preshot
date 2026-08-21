// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
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
    resizeGroup: vi.fn(),
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("selects on click and opens the viewer only on body double click", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups, { selectedImageId: "image-1" });
    renderGroups(groups, controller);
    const tile = screen.getByRole("button", { name: "选择参考图 1" });

    expect(tile).toHaveAttribute("aria-pressed", "true");
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

  it("renders only left/right image handles and isolates handle interaction", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);

    expect(
      Array.from(document.querySelectorAll("[data-image-resize-edge]"))
        .map((element) => element.getAttribute("data-image-resize-edge")),
    ).toEqual(["left", "right"]);
    expect(
      Array.from(document.querySelectorAll("[data-group-resize-edge]"))
        .map((element) => element.getAttribute("data-group-resize-edge")),
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

    fireEvent.pointerDown(screen.getByLabelText("从left调整参考图 1"), {
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerUp(document, { clientX: 0, clientY: 0 });

    expect(controller.selectImage).not.toHaveBeenCalled();
    expect(controller.moveImage).not.toHaveBeenCalled();
    expect(controller.openImage).not.toHaveBeenCalled();
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
      80 / 120 * 160 + 18,
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
    expect(committed?.frameHeight).toBeCloseTo(80 / 120 * 160);
    expect(committed?.groupHeight).toBeCloseTo(80 / 120 * 160 + 18);
  });

  it("restores the persisted layout when resize is cancelled", () => {
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

    expect(groupElement).toHaveStyle({ height: "120px" });
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
