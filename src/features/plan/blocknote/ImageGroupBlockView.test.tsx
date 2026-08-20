// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  ImageGroupBlockContext,
  type ImageGroupBlockController,
} from "./ImageGroupBlockContext";
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
) {
  return render(
    <ImageGroupBlockContext.Provider value={controller}>
      {groups.map((entry) => (
        <ImageGroupBlockView
          blockId={`block-${entry.id}`}
          groupId={entry.id}
          key={entry.id}
        />
      ))}
    </ImageGroupBlockContext.Provider>,
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

  it("suppresses the viewer after press-drag and commits a reorder", () => {
    const groups = [group("group-1", "image-1")];
    const controller = controllerFor(groups, { selectedImageId: "image-1" });
    renderGroups(groups, controller);
    const tile = screen.getByRole("button", { name: "选择参考图 1" });

    fireEvent.pointerDown(tile, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 0 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 0 });
    fireEvent.doubleClick(tile);

    expect(controller.selectImage).toHaveBeenCalledWith("image-1");
    expect(controller.moveImage).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      "group-1",
      0,
    );
    expect(controller.openImage).not.toHaveBeenCalled();
  });

  it("moves a selected image across groups at the computed insertion index", () => {
    const groups = [
      group("group-1", "image-1"),
      group("group-2", "image-2"),
    ];
    const controller = controllerFor(groups);
    renderGroups(groups, controller);
    const target = document.querySelector(
      '[data-image-group-id="group-2"] [data-image-id="image-2"]',
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    const tile = screen.getAllByRole("button", {
      name: "选择参考图 1",
    })[0]!;
    fireEvent.pointerDown(tile, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document, { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(document, { clientX: 20, clientY: 10 });

    expect(controller.moveImage).toHaveBeenCalledWith(
      "group-1",
      "image-1",
      "group-2",
      1,
    );
  });
});
