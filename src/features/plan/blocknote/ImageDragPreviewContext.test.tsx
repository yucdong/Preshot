// @vitest-environment jsdom
/* eslint-disable react-hooks/refs */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReferenceComponent,
  ReferenceImage,
} from "../../../domain/plan/canvas/models";
import {
  ImageDragPreviewProvider,
  type ImageDragPreviewController,
  useImageDragActivator,
  useImageDragPreview,
  useImageGroupDroppable,
  useImageTileDroppable,
} from "./ImageDragPreviewContext";

function image(id: string): ReferenceImage {
  return {
    id,
    file: `references/${id}.png`,
    aspectRatio: 1.5,
    sourceWidth: 900,
    sourceHeight: 600,
    frameWidth: 135,
    frameHeight: 90,
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
  };
}

function group(id: string, images: ReferenceImage[]): ReferenceComponent {
  return {
    id,
    name: id,
    type: "reference",
    x: 0,
    width: 300,
    height: 120,
    description: "",
    images,
  };
}

const sourceImage = image("source-image");
const initialGroups = [
  group("source", [image("before"), sourceImage]),
  group("target", [image("after")]),
  group("unchanged", [image("still")]),
];

interface ProviderHarnessProps {
  children?: ReactNode;
  enabled?: boolean;
  groups?: readonly ReferenceComponent[];
  imageGroupOrder?: readonly string[];
  onController(controller: ImageDragPreviewController): void;
  onMoveImage?: (
    fromGroupId: string,
    imageId: string,
    toGroupId: string,
    toIndex: number,
  ) => void;
  projectKey?: string;
  revision?: number;
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

function ControllerCapture({
  onController,
}: Pick<ProviderHarnessProps, "onController">) {
  const controller = useImageDragPreview();
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

function ProviderHarness({
  children,
  enabled = true,
  groups = initialGroups,
  imageGroupOrder,
  onController,
  onMoveImage = () => undefined,
  projectKey = "project-a",
  revision = 1,
  scrollContainerRef,
}: ProviderHarnessProps) {
  return (
    <ImageDragPreviewProvider
      enabled={enabled}
      imageGroupOrder={imageGroupOrder}
      imageGroups={groups}
      imageSources={Object.fromEntries(
        groups.flatMap((entry) =>
          entry.images.map((entryImage) => [
            entryImage.file,
            entryImage.id === "source-image"
              ? "data:image/png;base64,decoded"
              : `data:image/png;base64,${entryImage.id}`,
          ])),
      )}
      onMoveImage={onMoveImage}
      planRevision={revision}
      projectKey={projectKey}
      scrollContainerRef={scrollContainerRef}
    >
      <ControllerCapture onController={onController} />
      {children}
    </ImageDragPreviewProvider>
  );
}

function KeyboardTile({
  groupId,
  imageId,
  index,
  row,
}: {
  groupId: string;
  imageId: string;
  index: number;
  row: number;
}) {
  const drag = useImageDragPreview();
  const activator = useImageDragActivator(
    groupId,
    imageId,
    index,
    `references/${imageId}.png`,
  );
  const tile = useImageTileDroppable(groupId, imageId, index, row);
  return (
    <button
      {...activator.attributes}
      {...activator.listeners}
      data-testid={`keyboard-tile-${imageId}`}
      onFocus={() => drag.announceSelection(groupId, imageId, index)}
      ref={(node) => {
        activator.setNodeRef(node);
        activator.setActivatorNodeRef(node);
        tile.setNodeRef(node);
      }}
      type="button"
    >
      {imageId}
    </button>
  );
}

function KeyboardGroup({
  groupId,
  imageIds,
}: {
  groupId: string;
  imageIds: readonly string[];
}) {
  const groupDrop = useImageGroupDroppable(groupId);
  return (
    <div
      data-testid={`keyboard-group-${groupId}`}
      ref={groupDrop.setNodeRef}
    >
      {imageIds.map((imageId, index) => (
        <KeyboardTile
          groupId={groupId}
          imageId={imageId}
          index={index}
          key={imageId}
          row={0}
        />
      ))}
    </div>
  );
}

function KeyboardGroupsHarness() {
  return (
    <>
      <KeyboardGroup
        groupId="source"
        imageIds={["before", "source-image"]}
      />
      <KeyboardGroup groupId="target" imageIds={["after"]} />
      <KeyboardGroup groupId="unchanged" imageIds={["still"]} />
    </>
  );
}

function AutoScrollHarness({
  onController,
  onMoveImage,
}: Pick<ProviderHarnessProps, "onController" | "onMoveImage">) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  return (
    <div data-testid="drag-scroller" ref={scrollerRef}>
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
        scrollContainerRef={scrollerRef}
      >
        <PointerDragHarness />
      </ProviderHarness>
    </div>
  );
}

function KeyboardAutoScrollHarness({
  onController,
}: Pick<ProviderHarnessProps, "onController">) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  return (
    <div data-testid="drag-scroller" ref={scrollerRef}>
      <ProviderHarness
        onController={onController}
        scrollContainerRef={scrollerRef}
      >
        <KeyboardDragHarness />
      </ProviderHarness>
    </div>
  );
}

function KeyboardDragHarness() {
  const activator = useImageDragActivator("source", "source-image", 1);
  const sourceGroup = useImageGroupDroppable("source");
  const sourceTile = useImageTileDroppable("source", "source-image", 1, 0);
  return (
    <div ref={sourceGroup.setNodeRef}>
      <button
        {...activator.attributes}
        {...activator.listeners}
        ref={(node) => {
          activator.setNodeRef(node);
          activator.setActivatorNodeRef(node);
          sourceTile.setNodeRef(node);
        }}
        type="button"
      >
        拖动参考图
      </button>
    </div>
  );
}

function PointerDragHarness() {
  const activator = useImageDragActivator("source", "source-image", 1);
  const sourceGroup = useImageGroupDroppable("source");
  const sourceTile = useImageTileDroppable("source", "source-image", 1, 0);
  const targetGroup = useImageGroupDroppable("target");
  return (
    <>
      <div data-testid="pointer-source-group" ref={sourceGroup.setNodeRef}>
        <button
          {...activator.attributes}
          {...activator.listeners}
          data-testid="pointer-source-tile"
          ref={(node) => {
            activator.setNodeRef(node);
            activator.setActivatorNodeRef(node);
            sourceTile.setNodeRef(node);
          }}
          type="button"
        >
          指针拖动参考图
        </button>
      </div>
      <div data-testid="pointer-target-group" ref={targetGroup.setNodeRef}>
        空图片组
      </div>
    </>
  );
}

function DroppableImageTile({
  groupId,
  imageId,
  index,
  testId,
}: {
  groupId: string;
  imageId: string;
  index: number;
  testId: string;
}) {
  const tile = useImageTileDroppable(groupId, imageId, index, 0);
  return <div data-testid={testId} ref={tile.setNodeRef}>{imageId}</div>;
}

function CrossGroupHysteresisHarness() {
  const activator = useImageDragActivator("source", "source-image", 1);
  const sourceGroup = useImageGroupDroppable("source");
  const sourceTile = useImageTileDroppable("source", "source-image", 1, 0);
  const targetGroup = useImageGroupDroppable("target");
  return (
    <>
      <div data-testid="hysteresis-source-group" ref={sourceGroup.setNodeRef}>
        <button
          {...activator.attributes}
          {...activator.listeners}
          data-testid="hysteresis-active-tile"
          ref={(node) => {
            activator.setNodeRef(node);
            activator.setActivatorNodeRef(node);
            sourceTile.setNodeRef(node);
          }}
          type="button"
        >
          跨组拖动参考图
        </button>
      </div>
      <div data-testid="hysteresis-target-group" ref={targetGroup.setNodeRef}>
        <DroppableImageTile
          groupId="target"
          imageId="after"
          index={0}
          testId="hysteresis-target-tile"
        />
      </div>
    </>
  );
}

function SameGroupHysteresisHarness() {
  const activator = useImageDragActivator("source", "source-image", 2);
  const sourceGroup = useImageGroupDroppable("source");
  const activeTile = useImageTileDroppable("source", "source-image", 2, 0);
  return (
    <div data-testid="same-group" ref={sourceGroup.setNodeRef}>
      <DroppableImageTile
        groupId="source"
        imageId="before"
        index={0}
        testId="same-tile-before"
      />
      <DroppableImageTile
        groupId="source"
        imageId="middle"
        index={1}
        testId="same-tile-middle"
      />
      <button
        {...activator.attributes}
        {...activator.listeners}
        data-testid="same-tile-active"
        ref={(node) => {
          activator.setNodeRef(node);
          activator.setActivatorNodeRef(node);
          activeTile.setNodeRef(node);
        }}
        type="button"
      >
        同组拖动参考图
      </button>
    </div>
  );
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => undefined,
  } as DOMRect;
}

let animationFrames = new Map<number, FrameRequestCallback>();
let nextAnimationFrame = 1;

function flushAnimationFrames(timestamp = 0) {
  const callbacks = [...animationFrames.values()];
  animationFrames.clear();
  act(() => callbacks.forEach((callback) => callback(timestamp)));
}

beforeEach(() => {
  animationFrames = new Map();
  nextAnimationFrame = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationFrame++;
      animationFrames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => {
      animationFrames.delete(id);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageDragPreviewProvider transactions", () => {
  it("previews a cross-group move for every group without mutating the plan", async () => {
    const original = structuredClone(initialGroups);
    let controller: ImageDragPreviewController | null = null;
    render(
      <ProviderHarness onController={(next) => { controller = next; }} />,
    );
    await waitFor(() => expect(controller).not.toBeNull());

    act(() => {
      controller!.start({
        activeImageId: "source-image",
        sourceGroupId: "source",
        sourceIndex: 1,
      });
      controller!.project({ groupId: "target", index: 0 });
    });
    flushAnimationFrames();

    expect(initialGroups).toEqual(original);
    expect(controller!.state.previewGroups).toHaveLength(3);
    expect(
      controller!.getPreviewImages("source").map((entry) => entry.id),
    ).toEqual(["before"]);
    expect(
      controller!.getPreviewImages("target").map((entry) => entry.id),
    ).toEqual(["source-image", "after"]);
    expect(
      controller!.getPreviewImages("unchanged").map((entry) => entry.id),
    ).toEqual(["still"]);
    expect(controller!.state).toMatchObject({
      status: "dragging",
      sourceGroupId: "source",
      target: { groupId: "target", index: 0 },
      placeholder: {
        groupId: "target",
        imageId: "source-image",
        index: 0,
      },
      active: {
        decodedSource: "data:image/png;base64,decoded",
        sourceGroupId: "source",
        sourceIndex: 1,
        image: {
          id: "source-image",
          crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
        },
      },
    });
    expect(
      controller!.isDestinationDuplicateSuppressed(
        "target",
        "source-image",
      ),
    ).toBe(false);
  });

  it("commits one valid projection exactly once", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    render(
      <ProviderHarness
        onController={(next) => { controller = next; }}
        onMoveImage={onMoveImage}
      />,
    );
    await waitFor(() => expect(controller).not.toBeNull());

    act(() => {
      controller!.start({
        activeImageId: "source-image",
        sourceGroupId: "source",
        sourceIndex: 1,
      });
      controller!.project({ groupId: "target", index: 1 });
    });
    flushAnimationFrames();
    act(() => {
      controller!.commit();
      controller!.commit();
    });

    expect(onMoveImage).toHaveBeenCalledTimes(1);
    expect(onMoveImage).toHaveBeenCalledWith(
      "source",
      "source-image",
      "target",
      1,
    );
    expect(controller!.state.status).toBe("idle");
  });

  it("rolls back null targets and explicit cancellation to the exact snapshot", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    render(
      <ProviderHarness
        onController={(next) => { controller = next; }}
        onMoveImage={onMoveImage}
      />,
    );
    await waitFor(() => expect(controller).not.toBeNull());

    act(() => {
      controller!.start({
        activeImageId: "source-image",
        sourceGroupId: "source",
        sourceIndex: 1,
      });
    });
    const snapshotGroups = controller!.state.transaction!.snapshot.groups;
    act(() => controller!.project({ groupId: "target", index: 0 }));
    flushAnimationFrames();
    act(() => controller!.project(null));
    flushAnimationFrames();
    expect(controller!.state.projection?.groups).toBe(snapshotGroups);
    act(() => controller!.commit());
    expect(onMoveImage).not.toHaveBeenCalled();

    act(() => {
      controller!.start({
        activeImageId: "source-image",
        sourceGroupId: "source",
        sourceIndex: 1,
      });
      controller!.cancel();
    });
    expect(controller!.state).toBeDefined();
    expect(controller!.state.status).toBe("idle");
    expect(initialGroups[0]!.images[1]).toBe(sourceImage);
  });

  it("cancels stale revisions, source mutations, focus loss, and unmount", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    const onController = (next: ImageDragPreviewController) => {
      controller = next;
    };
    const result = render(
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
      />,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const start = () => act(() => {
      controller!.start({
        activeImageId: "source-image",
        sourceGroupId: "source",
        sourceIndex: 1,
      });
    });

    start();
    result.rerender(
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
        revision={2}
      />,
    );
    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    act(() => controller!.commit());
    expect(onMoveImage).not.toHaveBeenCalled();
    expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent(
      "方案已发生变化",
    );

    start();
    result.rerender(
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    await waitFor(() => expect(controller!.state.status).toBe("idle"));

    start();
    result.rerender(
      <ProviderHarness
        groups={[
          group("source", [image("before")]),
          initialGroups[1]!,
          initialGroups[2]!,
        ]}
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent(
      "图片已被删除",
    );

    result.rerender(
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    start();
    result.rerender(
      <ProviderHarness
        groups={initialGroups.slice(1)}
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent(
      "图片组已被删除",
    );

    result.rerender(
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    start();
    result.rerender(
      <ProviderHarness
        groups={[
          group("source", [
            image("before"),
            { ...sourceImage, frameWidth: sourceImage.frameWidth + 1 },
          ]),
          initialGroups[1]!,
          initialGroups[2]!,
        ]}
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    expect(screen.getByTestId("image-drag-announcement")).toHaveTextContent(
      "图片尺寸或解码状态已变化",
    );

    result.rerender(
      <ProviderHarness
        onController={onController}
        onMoveImage={onMoveImage}
        projectKey="project-b"
        revision={2}
      />,
    );
    start();
    fireEvent.blur(window);
    expect(controller!.state.status).toBe("idle");

    start();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(controller!.state.status).toBe("idle");

    start();
    fireEvent.pointerCancel(window);
    expect(controller!.state.status).toBe("idle");

    start();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(controller!.state.status).toBe("idle");

    start();
    const transaction = controller!.state.transaction;
    result.unmount();
    expect(transaction?.snapshot.groups.source?.images[1]?.id).toBe(
      "source-image",
    );
    expect(onMoveImage).not.toHaveBeenCalled();
  });
});

describe("ImageDragPreviewProvider dnd-kit boundary", () => {
  it("does not activate until pointer movement reaches six pixels", async () => {
    let controller: ImageDragPreviewController | null = null;
    render(
      <ProviderHarness onController={(next) => { controller = next; }}>
        <KeyboardDragHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", { name: "拖动参考图" });

    fireEvent.pointerDown(activator, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 15,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(controller!.state.status).toBe("idle");

    fireEvent.pointerMove(document, {
      clientX: 17,
      clientY: 10,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(controller!.state.status).toBe("idle");
  });

  it.each([
    { kind: "cross-group", expectedGroupId: "target", expectedIndex: 0 },
    { kind: "same-group", expectedGroupId: "source", expectedIndex: 0 },
  ])(
    "commits a stable $kind target when pointerup precedes its projection frame",
    async ({ kind, expectedGroupId, expectedIndex }) => {
      const onMoveImage = vi.fn();
      let controller: ImageDragPreviewController | null = null;
      const sameGroup = kind === "same-group";
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
          switch (this.dataset.testid) {
            case "hysteresis-source-group":
              return rect(0, 0, 180, 120);
            case "hysteresis-active-tile":
              return rect(80, 10, 80, 80);
            case "hysteresis-target-group":
              return rect(200, 0, 180, 120);
            case "hysteresis-target-tile":
              return rect(220, 10, 100, 80);
            case "same-group":
              return rect(0, 0, 260, 120);
            case "same-tile-before":
              return rect(10, 10, 60, 80);
            case "same-tile-middle":
              return rect(80, 10, 60, 80);
            case "same-tile-active":
              return rect(150, 10, 60, 80);
            default:
              return rect(0, 0, 0, 0);
          }
        });
      render(
        <ProviderHarness
          groups={sameGroup
            ? [group("source", [
                image("before"),
                image("middle"),
                sourceImage,
              ])]
            : initialGroups}
          onController={(next) => { controller = next; }}
          onMoveImage={onMoveImage}
        >
          {sameGroup
            ? <SameGroupHysteresisHarness />
            : <CrossGroupHysteresisHarness />}
        </ProviderHarness>,
      );
      await waitFor(() => expect(controller).not.toBeNull());
      const activator = screen.getByRole("button", {
        name: sameGroup ? "同组拖动参考图" : "跨组拖动参考图",
      });
      const pointerId = sameGroup ? 8 : 9;

      fireEvent.pointerDown(activator, {
        button: 0,
        clientX: sameGroup ? 180 : 100,
        clientY: 50,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(document, {
        clientX: sameGroup ? 188 : 108,
        clientY: 50,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      });
      await waitFor(() => expect(controller!.state.status).toBe("dragging"));
      fireEvent.pointerMove(document, {
        clientX: sameGroup ? 30 : 250,
        clientY: 50,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      });
      expect(animationFrames.size).toBeGreaterThan(0);

      fireEvent.pointerUp(document, {
        clientX: sameGroup ? 30 : 250,
        clientY: 50,
        isPrimary: true,
        pointerId,
        pointerType: "mouse",
      });

      await waitFor(() => expect(onMoveImage).toHaveBeenCalledTimes(1));
      expect(onMoveImage).toHaveBeenCalledWith(
        "source",
        "source-image",
        expectedGroupId,
        expectedIndex,
      );
      expect(controller!.state).toMatchObject({
        status: "landing",
        target: { groupId: expectedGroupId, index: expectedIndex },
      });
      expect(animationFrames.size).toBe(0);
      flushAnimationFrames();
      expect(onMoveImage).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels a same-frame outside release instead of applying its pending valid target", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        switch (this.dataset.testid) {
          case "hysteresis-source-group":
            return rect(0, 0, 180, 120);
          case "hysteresis-active-tile":
            return rect(80, 10, 80, 80);
          case "hysteresis-target-group":
            return rect(200, 0, 180, 120);
          case "hysteresis-target-tile":
            return rect(220, 10, 100, 80);
          default:
            return rect(0, 0, 0, 0);
        }
      });
    render(
      <ProviderHarness
        onController={(next) => { controller = next; }}
        onMoveImage={onMoveImage}
      >
        <CrossGroupHysteresisHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", {
      name: "跨组拖动参考图",
    });

    fireEvent.pointerDown(activator, {
      button: 0,
      clientX: 100,
      clientY: 50,
      isPrimary: true,
      pointerId: 10,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 108,
      clientY: 50,
      isPrimary: true,
      pointerId: 10,
      pointerType: "mouse",
    });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.pointerMove(document, {
      clientX: 250,
      clientY: 50,
      isPrimary: true,
      pointerId: 10,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 450,
      clientY: 50,
      isPrimary: true,
      pointerId: 10,
      pointerType: "mouse",
    });

    fireEvent.pointerUp(document, {
      clientX: 450,
      clientY: 50,
      isPrimary: true,
      pointerId: 10,
      pointerType: "mouse",
    });

    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    expect(onMoveImage).not.toHaveBeenCalled();
    expect(animationFrames.size).toBe(0);
    flushAnimationFrames();
    expect(onMoveImage).not.toHaveBeenCalled();
  });

  it.each([
    { candidateSamples: 1, expectedIndex: 0 },
    { candidateSamples: 2, expectedIndex: 1 },
  ])(
    "commits stable index $expectedIndex when pointerup precedes the RAF after $candidateSamples hysteresis sample(s)",
    async ({ candidateSamples, expectedIndex }) => {
      const onMoveImage = vi.fn();
      let controller: ImageDragPreviewController | null = null;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
          switch (this.dataset.testid) {
            case "hysteresis-source-group":
              return rect(0, 0, 180, 120);
            case "hysteresis-active-tile":
              return rect(80, 10, 80, 80);
            case "hysteresis-target-group":
              return rect(200, 0, 180, 120);
            case "hysteresis-target-tile":
              return rect(220, 10, 100, 80);
            default:
              return rect(0, 0, 0, 0);
          }
        });
      render(
        <ProviderHarness
          onController={(next) => { controller = next; }}
          onMoveImage={onMoveImage}
        >
          <CrossGroupHysteresisHarness />
        </ProviderHarness>,
      );
      await waitFor(() => expect(controller).not.toBeNull());
      const activator = screen.getByRole("button", {
        name: "跨组拖动参考图",
      });

      fireEvent.pointerDown(activator, {
        button: 0,
        clientX: 100,
        clientY: 50,
        isPrimary: true,
        pointerId: 11,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(document, {
        clientX: 108,
        clientY: 50,
        isPrimary: true,
        pointerId: 11,
        pointerType: "mouse",
      });
      await waitFor(() => expect(controller!.state.status).toBe("dragging"));
      fireEvent.pointerMove(document, {
        clientX: 250,
        clientY: 50,
        isPrimary: true,
        pointerId: 11,
        pointerType: "mouse",
      });
      flushAnimationFrames();
      await waitFor(() =>
        expect(controller!.state.target).toMatchObject({
          groupId: "target",
          index: 0,
        }));

      for (let sample = 0; sample < candidateSamples; sample += 1) {
        fireEvent.pointerMove(document, {
          clientX: 271 + sample,
          clientY: 50,
          isPrimary: true,
          pointerId: 11,
          pointerType: "mouse",
        });
      }
      expect(controller!.state.target).toMatchObject({
        groupId: "target",
        index: 0,
      });

      fireEvent.pointerUp(document, {
        clientX: 270 + candidateSamples,
        clientY: 50,
        isPrimary: true,
        pointerId: 11,
        pointerType: "mouse",
      });

      await waitFor(() => expect(onMoveImage).toHaveBeenCalledTimes(1));
      expect(onMoveImage).toHaveBeenCalledWith(
        "source",
        "source-image",
        "target",
        expectedIndex,
      );
      expect(controller!.state).toMatchObject({
        status: "landing",
        target: { groupId: "target", index: expectedIndex },
      });
      expect(animationFrames.size).toBe(0);
      flushAnimationFrames();
      expect(onMoveImage).toHaveBeenCalledTimes(1);
    },
  );

  it("projects into an empty group before pointerup and suppresses its landing duplicate", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        switch (this.dataset.testid) {
          case "pointer-source-group":
            return rect(0, 0, 160, 120);
          case "pointer-source-tile":
            return rect(10, 10, 120, 80);
          case "pointer-target-group":
            return rect(220, 0, 160, 120);
          default:
            return rect(0, 0, 0, 0);
        }
      });
    render(
      <ProviderHarness
        groups={[
          group("source", [image("before"), sourceImage]),
          group("target", []),
        ]}
        onController={(next) => { controller = next; }}
        onMoveImage={onMoveImage}
      >
        <PointerDragHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", {
      name: "指针拖动参考图",
    });

    fireEvent.pointerDown(activator, {
      button: 0,
      clientX: 50,
      clientY: 50,
      isPrimary: true,
      pointerId: 2,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 58,
      clientY: 50,
      isPrimary: true,
      pointerId: 2,
      pointerType: "mouse",
    });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.pointerMove(document, {
      clientX: 260,
      clientY: 50,
      isPrimary: true,
      pointerId: 2,
      pointerType: "mouse",
    });
    flushAnimationFrames();

    await waitFor(() =>
      expect(controller!.state.target).toMatchObject({
        groupId: "target",
        index: 0,
      }));
    expect(controller!.getPreviewImages("source").map((entry) => entry.id))
      .toEqual(["before"]);
    expect(controller!.getPreviewImages("target").map((entry) => entry.id))
      .toEqual(["source-image"]);
    expect(onMoveImage).not.toHaveBeenCalled();

    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    fireEvent.pointerUp(document, {
      clientX: 260,
      clientY: 50,
      isPrimary: true,
      pointerId: 2,
      pointerType: "mouse",
    });
    await waitFor(() => expect(onMoveImage).toHaveBeenCalledTimes(1));
    expect(onMoveImage).toHaveBeenCalledWith(
      "source",
      "source-image",
      "target",
      0,
    );
    expect(controller!.state.status).toBe("landing");
    expect(controller!.isDestinationDuplicateSuppressed(
      "target",
      "source-image",
    )).toBe(true);
    expect(controller!.isViewerSuppressed()).toBe(true);
    now.mockReturnValue(1_499);
    expect(controller!.isViewerSuppressed()).toBe(true);
    now.mockReturnValue(1_500);
    expect(controller!.isViewerSuppressed()).toBe(false);
  });

  it.each([
    { candidateSamples: 1, expectedIndex: 0 },
    { candidateSamples: 2, expectedIndex: 1 },
  ])(
    "commits the cross-group preview after $candidateSamples pending movement sample(s)",
    async ({ candidateSamples, expectedIndex }) => {
      const onMoveImage = vi.fn();
      let controller: ImageDragPreviewController | null = null;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
          switch (this.dataset.testid) {
            case "hysteresis-source-group":
              return rect(0, 0, 180, 120);
            case "hysteresis-active-tile":
              return rect(80, 10, 80, 80);
            case "hysteresis-target-group":
              return rect(200, 0, 180, 120);
            case "hysteresis-target-tile":
              return rect(220, 10, 100, 80);
            default:
              return rect(0, 0, 0, 0);
          }
        });
      render(
        <ProviderHarness
          onController={(next) => { controller = next; }}
          onMoveImage={onMoveImage}
        >
          <CrossGroupHysteresisHarness />
        </ProviderHarness>,
      );
      await waitFor(() => expect(controller).not.toBeNull());
      const activator = screen.getByRole("button", {
        name: "跨组拖动参考图",
      });

      fireEvent.pointerDown(activator, {
        button: 0,
        clientX: 100,
        clientY: 50,
        isPrimary: true,
        pointerId: 5,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(document, {
        clientX: 108,
        clientY: 50,
        isPrimary: true,
        pointerId: 5,
        pointerType: "mouse",
      });
      await waitFor(() => expect(controller!.state.status).toBe("dragging"));
      fireEvent.pointerMove(document, {
        clientX: 250,
        clientY: 50,
        isPrimary: true,
        pointerId: 5,
        pointerType: "mouse",
      });
      flushAnimationFrames();
      await waitFor(() =>
        expect(controller!.state.target).toMatchObject({
          groupId: "target",
          index: 0,
        }));

      for (let sample = 0; sample < candidateSamples; sample += 1) {
        fireEvent.pointerMove(document, {
          clientX: 271 + sample,
          clientY: 50,
          isPrimary: true,
          pointerId: 5,
          pointerType: "mouse",
        });
        flushAnimationFrames();
      }
      expect(controller!.state.target).toMatchObject({
        groupId: "target",
        index: expectedIndex,
      });
      const previewIndex = controller!.state.target!.index;

      fireEvent.pointerUp(document, {
        clientX: 271 + candidateSamples - 1,
        clientY: 50,
        isPrimary: true,
        pointerId: 5,
        pointerType: "mouse",
      });
      await waitFor(() => expect(onMoveImage).toHaveBeenCalledTimes(1));
      expect(onMoveImage).toHaveBeenCalledWith(
        "source",
        "source-image",
        "target",
        previewIndex,
      );
    },
  );

  it.each([
    { candidateSamples: 1, expectedIndex: 0 },
    { candidateSamples: 2, expectedIndex: 1 },
  ])(
    "commits the same-group preview after $candidateSamples pending movement sample(s)",
    async ({ candidateSamples, expectedIndex }) => {
      const onMoveImage = vi.fn();
      let controller: ImageDragPreviewController | null = null;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
          switch (this.dataset.testid) {
            case "same-group":
              return rect(0, 0, 260, 120);
            case "same-tile-before":
              return rect(10, 10, 60, 80);
            case "same-tile-middle":
              return rect(80, 10, 60, 80);
            case "same-tile-active":
              return rect(150, 10, 60, 80);
            default:
              return rect(0, 0, 0, 0);
          }
        });
      render(
        <ProviderHarness
          groups={[
            group("source", [
              image("before"),
              image("middle"),
              sourceImage,
            ]),
          ]}
          onController={(next) => { controller = next; }}
          onMoveImage={onMoveImage}
        >
          <SameGroupHysteresisHarness />
        </ProviderHarness>,
      );
      await waitFor(() => expect(controller).not.toBeNull());
      const activator = screen.getByRole("button", {
        name: "同组拖动参考图",
      });

      fireEvent.pointerDown(activator, {
        button: 0,
        clientX: 180,
        clientY: 50,
        isPrimary: true,
        pointerId: 6,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(document, {
        clientX: 188,
        clientY: 50,
        isPrimary: true,
        pointerId: 6,
        pointerType: "mouse",
      });
      await waitFor(() => expect(controller!.state.status).toBe("dragging"));
      fireEvent.pointerMove(document, {
        clientX: 30,
        clientY: 50,
        isPrimary: true,
        pointerId: 6,
        pointerType: "mouse",
      });
      flushAnimationFrames();
      await waitFor(() =>
        expect(controller!.state.target).toMatchObject({
          groupId: "source",
          index: 0,
        }));

      for (let sample = 0; sample < candidateSamples; sample += 1) {
        fireEvent.pointerMove(document, {
          clientX: 41 + sample,
          clientY: 50,
          isPrimary: true,
          pointerId: 6,
          pointerType: "mouse",
        });
        flushAnimationFrames();
      }
      expect(controller!.state.target).toMatchObject({
        groupId: "source",
        index: expectedIndex,
      });
      const previewIndex = controller!.state.target!.index;

      fireEvent.pointerUp(document, {
        clientX: 41 + candidateSamples - 1,
        clientY: 50,
        isPrimary: true,
        pointerId: 6,
        pointerType: "mouse",
      });
      await waitFor(() => expect(onMoveImage).toHaveBeenCalledTimes(1));
      expect(onMoveImage).toHaveBeenCalledWith(
        "source",
        "source-image",
        "source",
        previewIndex,
      );
    },
  );

  it("cancels an outside pointer release without committing the last valid preview", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        switch (this.dataset.testid) {
          case "hysteresis-source-group":
            return rect(0, 0, 180, 120);
          case "hysteresis-active-tile":
            return rect(80, 10, 80, 80);
          case "hysteresis-target-group":
            return rect(200, 0, 180, 120);
          case "hysteresis-target-tile":
            return rect(220, 10, 100, 80);
          default:
            return rect(0, 0, 0, 0);
        }
      });
    render(
      <ProviderHarness
        onController={(next) => { controller = next; }}
        onMoveImage={onMoveImage}
      >
        <CrossGroupHysteresisHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", {
      name: "跨组拖动参考图",
    });

    fireEvent.pointerDown(activator, {
      button: 0,
      clientX: 100,
      clientY: 50,
      isPrimary: true,
      pointerId: 7,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 108,
      clientY: 50,
      isPrimary: true,
      pointerId: 7,
      pointerType: "mouse",
    });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.pointerMove(document, {
      clientX: 250,
      clientY: 50,
      isPrimary: true,
      pointerId: 7,
      pointerType: "mouse",
    });
    flushAnimationFrames();
    await waitFor(() =>
      expect(controller!.state.target).toMatchObject({
        groupId: "target",
        index: 0,
      }));

    fireEvent.pointerMove(document, {
      clientX: 450,
      clientY: 50,
      isPrimary: true,
      pointerId: 7,
      pointerType: "mouse",
    });
    flushAnimationFrames();
    expect(controller!.state.target).toBeNull();
    fireEvent.pointerUp(document, {
      clientX: 450,
      clientY: 50,
      isPrimary: true,
      pointerId: 7,
      pointerType: "mouse",
    });

    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    expect(onMoveImage).not.toHaveBeenCalled();
  });

  it("exposes disabled activators until the group view feature gate is enabled", async () => {
    let controller: ImageDragPreviewController | null = null;
    render(
      <ProviderHarness
        enabled={false}
        onController={(next) => { controller = next; }}
      >
        <KeyboardDragHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());

    expect(controller!.enabled).toBe(false);
    expect(screen.getByRole("button", { name: "拖动参考图" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("supports row-major keyboard movement, group switching, commit, cancel, and polite stable announcements", async () => {
    const onMoveImage = vi.fn();
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        const id = this.dataset.testid;
        if (id === "keyboard-group-source") return rect(0, 0, 300, 120);
        if (id === "keyboard-tile-before") return rect(10, 10, 90, 80);
        if (id === "keyboard-tile-source-image") {
          return rect(110, 10, 120, 80);
        }
        if (id === "keyboard-group-target") return rect(0, 150, 300, 120);
        if (id === "keyboard-tile-after") return rect(10, 160, 90, 80);
        if (id === "keyboard-group-unchanged") {
          return rect(0, 300, 300, 120);
        }
        if (id === "keyboard-tile-still") return rect(10, 310, 90, 80);
        return rect(0, 0, 0, 0);
      });
    render(
      <ProviderHarness
        onController={(next) => { controller = next; }}
        onMoveImage={onMoveImage}
      >
        <KeyboardGroupsHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", { name: "source-image" });
    const status = screen.getByTestId("image-drag-announcement");

    activator.focus();
    fireEvent.focus(activator);
    expect(status).toHaveTextContent(
      "已选择第 1 个图片组“source”中的第 2 张图片",
    );
    fireEvent.keyDown(activator, { code: "Space", key: " " });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    expect(status).toHaveTextContent("已拿起第 1 个图片组");

    fireEvent.keyDown(activator, { code: "Home", key: "Home" });
    flushAnimationFrames();
    await waitFor(() =>
      expect(controller!.state.target).toEqual({
        groupId: "source",
        index: 0,
      }));
    expect(status).toHaveTextContent(
      "第 1 个图片组“source”的第 1 位",
    );
    fireEvent.keyDown(activator, { code: "Home", key: "Home" });
    expect(status).toHaveTextContent("已经到达当前图片组的边界");

    fireEvent.keyDown(activator, {
      code: "ArrowRight",
      ctrlKey: true,
      key: "ArrowRight",
    });
    expect(controller!.state.target).toEqual({
      groupId: "target",
      index: 0,
    });

    fireEvent.keyDown(activator, { code: "End", key: "End" });
    expect(controller!.state.target).toEqual({
      groupId: "target",
      index: 1,
    });
    expect(status).toHaveTextContent(
      "第 2 个图片组“target”的第 2 位",
    );

    fireEvent.keyDown(activator, { code: "Enter", key: "Enter" });
    await waitFor(() => expect(onMoveImage).toHaveBeenCalledTimes(1));
    expect(onMoveImage).toHaveBeenCalledWith(
      "source",
      "source-image",
      "target",
      1,
    );
    expect(status).toHaveTextContent("已将图片放到第 2 个图片组");
    fireEvent.keyDown(activator, { code: "Enter", key: "Enter" });
    expect(onMoveImage).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(activator, { code: "Space", key: " " });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.keyDown(activator, {
      code: "ArrowRight",
      ctrlKey: true,
      key: "ArrowRight",
    });
    fireEvent.keyDown(activator, {
      code: "ArrowLeft",
      metaKey: true,
      key: "ArrowLeft",
    });
    expect(controller!.state.target?.groupId).toBe("source");
    fireEvent.keyDown(activator, { code: "ArrowLeft", key: "ArrowLeft" });
    fireEvent.keyDown(activator, { code: "Escape", key: "Escape" });
    await waitFor(() => expect(controller!.state.status).toBe("idle"));
    expect(status).toHaveTextContent("已取消移动");
    expect(onMoveImage).toHaveBeenCalledTimes(1);
  });

  it("uses visible document order for keyboard movement and Chinese group numbers", async () => {
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        const id = this.dataset.testid;
        if (id === "keyboard-group-target") return rect(0, 0, 300, 120);
        if (id === "keyboard-tile-after") return rect(10, 10, 90, 80);
        if (id === "keyboard-group-source") return rect(0, 150, 300, 120);
        if (id === "keyboard-tile-before") return rect(10, 160, 90, 80);
        if (id === "keyboard-tile-source-image") {
          return rect(110, 160, 120, 80);
        }
        if (id === "keyboard-group-unchanged") {
          return rect(0, 300, 300, 120);
        }
        if (id === "keyboard-tile-still") return rect(10, 310, 90, 80);
        return rect(0, 0, 0, 0);
      });
    render(
      <ProviderHarness
        imageGroupOrder={["target", "source", "unchanged"]}
        onController={(next) => { controller = next; }}
      >
        <KeyboardGroupsHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", { name: "source-image" });
    const status = screen.getByTestId("image-drag-announcement");

    activator.focus();
    fireEvent.focus(activator);
    expect(status).toHaveTextContent(
      "已选择第 2 个图片组“source”中的第 2 张图片",
    );
    fireEvent.keyDown(activator, { code: "Space", key: " " });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    expect(controller!.state.transaction?.snapshot.groupOrder).toEqual([
      "target",
      "source",
      "unchanged",
    ]);
    fireEvent.keyDown(activator, {
      code: "ArrowLeft",
      ctrlKey: true,
      key: "ArrowLeft",
    });
    expect(controller!.state.target).toEqual({
      groupId: "target",
      index: 1,
    });
    expect(status).toHaveTextContent(
      "第 1 个图片组“target”的第 2 位",
    );
    expect(screen.getByTestId("image-drag-keyboard-focus")).toHaveFocus();

    fireEvent.keyDown(activator, {
      code: "ArrowLeft",
      ctrlKey: true,
      key: "ArrowLeft",
    });
    expect(controller!.state.target).toEqual({
      groupId: "target",
      index: 1,
    });
    expect(status).toHaveTextContent("已经没有相邻的图片组");

    fireEvent.keyDown(activator, {
      code: "ArrowRight",
      metaKey: true,
      key: "ArrowRight",
    });
    expect(controller!.state.target?.groupId).toBe("source");
    expect(screen.getByTestId("image-drag-keyboard-focus")).toHaveFocus();

    const tabAccepted = fireEvent.keyDown(activator, {
      code: "Tab",
      key: "Tab",
    });
    expect(tabAccepted).toBe(false);
    expect(controller!.state.status).toBe("dragging");
    expect(screen.getByTestId("image-drag-keyboard-focus")).toHaveFocus();
    fireEvent.keyDown(activator, { code: "Escape", key: "Escape" });
    flushAnimationFrames();
    await waitFor(() => expect(activator).toHaveFocus());
  });

  it("keeps auto-scrolling from the latest physical pointer, stops at center, and cleans up on cancel", async () => {
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        switch (this.dataset.testid) {
          case "drag-scroller":
            return rect(0, 0, 400, 300);
          case "pointer-source-group":
            return rect(0, 0, 160, 120);
          case "pointer-source-tile":
            return rect(10, 10, 120, 80);
          case "pointer-target-group":
            return rect(220, 0, 160, 120);
          default:
            return rect(0, 0, 0, 0);
        }
      });
    render(
      <AutoScrollHarness
        onController={(next) => { controller = next; }}
        onMoveImage={vi.fn()}
      />,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const scroller = screen.getByTestId("drag-scroller");
    Object.defineProperties(scroller, {
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    const scrollBy = vi.fn((options: ScrollToOptions) => {
      scroller.scrollLeft += options.left ?? 0;
      scroller.scrollTop += options.top ?? 0;
    });
    Object.defineProperty(scroller, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    const activator = screen.getByRole("button", {
      name: "指针拖动参考图",
    });

    fireEvent.pointerDown(activator, {
      button: 0,
      clientX: 50,
      clientY: 50,
      isPrimary: true,
      pointerId: 4,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 58,
      clientY: 50,
      isPrimary: true,
      pointerId: 4,
      pointerType: "mouse",
    });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.pointerMove(document, {
      clientX: 60,
      clientY: 286,
      isPrimary: true,
      pointerId: 4,
      pointerType: "mouse",
    });
    flushAnimationFrames(16);

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    flushAnimationFrames(32);
    expect(scrollBy).toHaveBeenCalledTimes(2);
    const accumulatedAt = scroller.scrollTop;

    fireEvent.pointerMove(document, {
      clientX: 200,
      clientY: 150,
      isPrimary: true,
      pointerId: 4,
      pointerType: "mouse",
    });
    flushAnimationFrames(48);
    flushAnimationFrames(64);
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(scroller.scrollTop).toBe(accumulatedAt);

    const stoppedAt = scroller.scrollTop;
    fireEvent.pointerCancel(window, { pointerId: 4 });
    fireEvent.pointerMove(document, {
      clientX: 200,
      clientY: 292,
      isPrimary: true,
      pointerId: 4,
      pointerType: "mouse",
    });
    flushAnimationFrames();
    expect(scroller.scrollTop).toBe(stoppedAt);
    expect(controller!.state.status).toBe("idle");
  });

  it("cancels a scheduled pointer auto-scroll frame on unmount", async () => {
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        return this.dataset.testid === "drag-scroller"
          ? rect(0, 0, 400, 300)
          : rect(0, 0, 160, 120);
      });
    const result = render(
      <AutoScrollHarness
        onController={(next) => { controller = next; }}
        onMoveImage={vi.fn()}
      />,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const scroller = screen.getByTestId("drag-scroller");
    const scrollBy = vi.fn();
    Object.defineProperty(scroller, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    const activator = screen.getByRole("button", {
      name: "指针拖动参考图",
    });
    fireEvent.pointerDown(activator, {
      button: 0,
      clientX: 50,
      clientY: 50,
      isPrimary: true,
      pointerId: 5,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      clientX: 58,
      clientY: 50,
      isPrimary: true,
      pointerId: 5,
      pointerType: "mouse",
    });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    fireEvent.pointerMove(document, {
      clientX: 200,
      clientY: 292,
      isPrimary: true,
      pointerId: 5,
      pointerType: "mouse",
    });
    const callsBeforeUnmount = scrollBy.mock.calls.length;
    result.unmount();
    flushAnimationFrames(80);
    expect(scrollBy).toHaveBeenCalledTimes(callsBeforeUnmount);
  });

  it("never starts pointer auto-scroll for keyboard drags or after unmount", async () => {
    let controller: ImageDragPreviewController | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        return this.dataset.testid === "drag-scroller"
          ? rect(0, 0, 400, 300)
          : rect(0, 0, 160, 120);
      });
    const result = render(
      <KeyboardAutoScrollHarness
        onController={(next) => { controller = next; }}
      />,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const scroller = screen.getByTestId("drag-scroller");
    const scrollBy = vi.fn();
    Object.defineProperty(scroller, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    const activator = screen.getByRole("button", { name: "拖动参考图" });

    fireEvent.pointerMove(document, {
      clientX: 200,
      clientY: 292,
      isPrimary: true,
      pointerId: 90,
      pointerType: "mouse",
    });
    fireEvent.keyDown(activator, { code: "Space", key: " " });
    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    flushAnimationFrames(16);
    expect(scrollBy).not.toHaveBeenCalled();

    result.unmount();
    fireEvent.pointerMove(document, {
      clientX: 200,
      clientY: 292,
      isPrimary: true,
      pointerId: 90,
      pointerType: "mouse",
    });
    flushAnimationFrames(32);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("mounts overlay metadata and Chinese keyboard announcements", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    let controller: ImageDragPreviewController | null = null;
    render(
      <ProviderHarness onController={(next) => { controller = next; }}>
        <KeyboardDragHarness />
      </ProviderHarness>,
    );
    await waitFor(() => expect(controller).not.toBeNull());
    const activator = screen.getByRole("button", { name: "拖动参考图" });

    fireEvent.keyDown(activator, { code: "Space", key: " " });

    await waitFor(() => expect(controller!.state.status).toBe("dragging"));
    const overlay = document.body.querySelector<HTMLElement>(
      "[data-image-drag-overlay]",
    );
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute("data-reduced-motion", "true");
    expect(overlay).toHaveStyle({ pointerEvents: "none", transition: "none" });
    expect(
      overlay?.querySelector<HTMLImageElement>(
        ".preshot-image-drag-overlay-image",
      ),
    ).toHaveAttribute("src", "data:image/png;base64,decoded");
    expect(document.body).toHaveTextContent(
      "已拿起第 1 个图片组“source”中的第 2 张图片",
    );
    expect(document.body).toHaveTextContent("按 Escape 键取消");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(controller!.state.status).toBe("idle"));
  });
});
