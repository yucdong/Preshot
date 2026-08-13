import { Extension, Node, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { ReferenceComponent } from "../../domain/plan/canvas/models";
import { MIN_COMPONENT_HEIGHT, MIN_COMPONENT_WIDTH } from "../../domain/plan/canvas/models";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "../../domain/plan/canvas/geometry";
import { layoutDocumentImageGroup } from "../../domain/plan/canvas/documentImageGroupLayout";
import { imageCropForView, imageViewCss } from "../../domain/plan/canvas/imageView";
import { IMAGE_GROUP_NODE_NAME } from "../../domain/plan/canvas/document";

export interface DocumentImageGroupController {
  getGroup(id: string): ReferenceComponent | undefined;
  getImageSrc(file: string): string | undefined;
  getSelectedImageId(groupId: string): string;
  createGroup(): string | null;
  onAddImages(id: string): void;
  onOpenImage(componentId: string, imageId: string, file: string): void;
  onRemoveImage(componentId: string, imageId: string): void;
  onRemoveGroup(id: string): void;
  onResizeGroup(
    id: string,
    rect: { x?: number; width?: number; height?: number },
  ): void;
  onSetImageFrame(
    componentId: string,
    imageId: string,
    frame: { frameWidth: number; frameHeight: number },
  ): void;
  onScaleImages(id: string, scale: number): void;
  onSelectImage(groupId: string, imageId: string): void;
  getScale(): number;
  registerView(id: string, render: () => void): () => void;
  onActivateBlankLine?(anchor: BlankLineInsertAnchor | null): void;
}

interface BlankLineInsertState {
  activeOffset: number | null;
}

export interface BlankLineInsertAnchor {
  position: number;
  left: number;
  top: number;
  bottom: number;
}

const blankLineInsertPluginKey = new PluginKey<BlankLineInsertState>("imageGroupInsertControls");
const MIN_DOCUMENT_IMAGE_FRAME = 32;
const IMAGE_SNAP_THRESHOLD = 6;
const DOCUMENT_CONTENT_WIDTH = contentSize(DEFAULT_PAGE_GEOMETRY).width;

type ResizeDirection =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const IMAGE_RESIZE_DIRECTIONS: readonly ResizeDirection[] = [
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const GROUP_CORNER_DIRECTIONS: readonly ResizeDirection[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const GROUP_EDGE_DIRECTIONS: readonly ResizeDirection[] = [
  "left",
  "right",
  "top",
  "bottom",
];

const RESIZE_DIRECTION_LABELS: Record<ResizeDirection, string> = {
  left: "左边",
  right: "右边",
  top: "上边",
  bottom: "下边",
  "top-left": "左上角",
  "top-right": "右上角",
  "bottom-left": "左下角",
  "bottom-right": "右下角",
};

function directionAffects(direction: ResizeDirection, edge: "left" | "right" | "top" | "bottom") {
  return direction === edge || direction.includes(edge);
}

function nearestDimension(value: number, candidates: readonly number[]): number | null {
  return candidates.find((candidate) => Math.abs(candidate - value) <= IMAGE_SNAP_THRESHOLD) ?? null;
}

function decodedGroupId(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function insertImageGroupAt(
  editor: Editor,
  controller: DocumentImageGroupController,
  position: number,
  preserveFollowingBlankLine = false,
): boolean {
  const groupId = controller.createGroup();
  if (!groupId) return false;
  const content: Array<{ type: string; attrs?: { groupId: string } }> = [
    { type: IMAGE_GROUP_NODE_NAME, attrs: { groupId } },
  ];
  if (!preserveFollowingBlankLine) content.push({ type: "paragraph" });
  return editor
    .chain()
    .focus()
    .insertContentAt(position, content)
    .run();
}

export function insertImageGroupAtDocumentEnd(
  editor: Editor,
  controller: DocumentImageGroupController,
): boolean {
  return insertImageGroupAt(editor, controller, editor.state.doc.content.size);
}

export function insertImageGroupAtBlankLine(
  editor: Editor,
  controller: DocumentImageGroupController,
  position: number,
): boolean {
  const inserted = insertImageGroupAt(editor, controller, position, true);
  if (!inserted) return false;
  window.setTimeout(() => {
    if (editor.isDestroyed) return;
    let blankOffset: number | null = null;
    editor.state.doc.forEach((node, offset) => {
      if (blankOffset !== null || offset < position) return;
      if (node.type.name === "paragraph" && node.content.size === 0) blankOffset = offset;
    });
    if (blankOffset === null) return;
    const coords = editor.view.coordsAtPos(blankOffset + 1);
    controller.onActivateBlankLine?.({
      position: blankOffset,
      left: coords.left,
      top: coords.top,
      bottom: coords.bottom,
    });
  }, 0);
  return true;
}

export function createDocumentImageGroupExtension(
  controller: DocumentImageGroupController,
) {
  return Node.create({
    name: IMAGE_GROUP_NODE_NAME,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return {
        groupId: {
          default: "",
          parseHTML: (element) => decodedGroupId(element.getAttribute("data-preshot-group-id")),
          renderHTML: (attributes) => ({
            "data-preshot-group-id": encodeURIComponent(String(attributes.groupId ?? "")),
          }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `figure[data-preshot-node="${IMAGE_GROUP_NODE_NAME}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["figure", {
        "data-preshot-node": IMAGE_GROUP_NODE_NAME,
        "data-preshot-group-id": HTMLAttributes["data-preshot-group-id"],
      }];
    },

    addKeyboardShortcuts() {
      const removeSelected = () => {
        const selection = this.editor.state.selection;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) {
          return false;
        }
        const groupId = decodedGroupId(selection.node.attrs.groupId);
        if (!groupId) return false;
        controller.onRemoveGroup(groupId);
        return true;
      };
      return { Backspace: removeSelected, Delete: removeSelected };
    },

    addNodeView() {
      return ({ node, getPos, editor }) => {
        let groupId = decodedGroupId(node.attrs.groupId);
        let selectedImageId = "";
        let activeResizeCleanup: (() => void) | null = null;
        const dom = document.createElement("section");
        dom.className = "preshot-document-image-group";
        dom.contentEditable = "false";
        dom.dataset.imageGroupId = groupId;
        dom.dataset.preshotSurface = "true";

        const dragHandle = document.createElement("button");
        dragHandle.type = "button";
        dragHandle.ariaLabel = "拖动图片组";
        dragHandle.title = "拖动图片组";
        dragHandle.dataset.dragHandle = "";
        dragHandle.className = "preshot-document-image-group-drag";
        dragHandle.textContent = "⋮⋮";

        const grid = document.createElement("div");
        grid.className = "preshot-document-image-group-grid";

        const empty = document.createElement("button");
        empty.type = "button";
        empty.ariaLabel = "添加图片";
        empty.className = "preshot-document-image-group-empty";
        empty.textContent = "+";
        empty.addEventListener("click", (event) => {
          event.stopPropagation();
          controller.onAddImages(groupId);
        });

        const verticalGuide = document.createElement("div");
        verticalGuide.className = "preshot-document-image-guide is-vertical";
        const horizontalGuide = document.createElement("div");
        horizontalGuide.className = "preshot-document-image-guide is-horizontal";

        dom.append(dragHandle, grid, empty, verticalGuide, horizontalGuide);

        for (const direction of GROUP_EDGE_DIRECTIONS) {
          const handle = document.createElement("div");
          handle.className = `preshot-document-image-group-edge is-${direction}`;
          handle.role = "separator";
          handle.tabIndex = 0;
          handle.ariaLabel = `拖动图片组${RESIZE_DIRECTION_LABELS[direction]}`;
          handle.dataset.groupResizeHandle = "edge";
          handle.dataset.groupResizeEdge = direction;
          dom.append(handle);
        }

        for (const direction of GROUP_CORNER_DIRECTIONS) {
          const handle = document.createElement("div");
          handle.className = `preshot-document-image-group-corner is-${direction}`;
          handle.role = "separator";
          handle.tabIndex = 0;
          handle.ariaLabel = `从${RESIZE_DIRECTION_LABELS[direction]}调整图片组宽高`;
          handle.dataset.groupResizeHandle = "corner";
          handle.dataset.groupResizeEdge = direction;
          dom.append(handle);
        }

        const safeScale = () => {
          const scale = controller.getScale();
          return Number.isFinite(scale) && scale > 0 ? scale : 1;
        };

        const select = () => {
          const position = getPos();
          if (position === undefined) return;
          editor.chain().focus().setNodeSelection(position).run();
        };

        const clearGuides = () => {
          verticalGuide.removeAttribute("data-visible");
          horizontalGuide.removeAttribute("data-visible");
        };

        const updateFrameView = (
          frame: HTMLElement,
          image: ReferenceComponent["images"][number],
          index: number,
          frameScale: number,
        ) => {
          frame.dataset.frameScale = String(frameScale);
          frame.dataset.frameWidth = String(image.frameWidth);
          frame.dataset.frameHeight = String(image.frameHeight);
          frame.classList.toggle("is-selected", selectedImageId === image.id);
          frame.style.width = `${Math.max(1, image.frameWidth * frameScale)}px`;
          frame.style.height = `${Math.max(1, image.frameHeight * frameScale)}px`;
          const imageButton = frame.querySelector<HTMLButtonElement>(
            ".preshot-document-image-button",
          );
          if (imageButton) {
            imageButton.ariaLabel = `选择参考图 ${index + 1}`;
            imageButton.ariaPressed = selectedImageId === image.id ? "true" : "false";
            const src = controller.getImageSrc(image.file);
            let imageElement = imageButton.querySelector("img");
            if (!src) {
              imageElement?.remove();
            } else {
              if (!imageElement) {
                imageElement = document.createElement("img");
                imageElement.draggable = false;
                imageButton.append(imageElement);
              }
              imageElement.alt = image.caption?.trim() || "参考图";
              if (imageElement.src !== src) imageElement.src = src;
              Object.assign(imageElement.style, imageViewCss(imageCropForView(image)));
            }
          }
          const indexBadge = frame.querySelector<HTMLElement>(
            ".preshot-document-image-index",
          );
          if (indexBadge) indexBadge.textContent = String(index + 1).padStart(2, "0");
        };

        const render = () => {
          const group = controller.getGroup(groupId);
          dom.dataset.imageGroupId = groupId;
          const images = group?.images ?? [];
          const groupWidth = Math.max(
            MIN_COMPONENT_WIDTH,
            Math.min(DOCUMENT_CONTENT_WIDTH, group?.width ?? DOCUMENT_CONTENT_WIDTH),
          );
          const groupX = Math.max(
            0,
            Math.min(DOCUMENT_CONTENT_WIDTH - groupWidth, group?.x ?? 0),
          );
          const groupHeight = Math.max(MIN_COMPONENT_HEIGHT, group?.height ?? 220);
          dom.style.width = `${groupWidth}px`;
          dom.style.height = `${groupHeight}px`;
          dom.style.marginLeft = `${groupX}px`;
          empty.hidden = images.length > 0;
          grid.hidden = images.length === 0;
          const averageHeight = images.length > 0
            ? images.reduce((total, image) => total + image.frameHeight, 0) / images.length
            : 135;
          dom.style.setProperty("--image-group-height", `${averageHeight}px`);
          const frameScale = layoutDocumentImageGroup(
            images,
            groupWidth,
            groupHeight,
          ).scale;
          dom.dataset.imageGroupFitted = frameScale < 0.999 ? "true" : "false";
          const existingFrames = Array.from(
            grid.querySelectorAll<HTMLElement>(".preshot-document-image-frame"),
          );
          const canReuseFrames = existingFrames.length === images.length &&
            existingFrames.every((frame, index) => frame.dataset.imageId === images[index]?.id);
          if (canReuseFrames) {
            existingFrames.forEach((frame, index) => {
              const image = images[index];
              if (image) updateFrameView(frame, image, index, frameScale);
            });
            return;
          }
          grid.replaceChildren();
          images.forEach((image, index) => {
            const frame = document.createElement("div");
            frame.className = "preshot-document-image-frame";
            frame.dataset.imageId = image.id;

            const imageButton = document.createElement("button");
            imageButton.type = "button";
            imageButton.className = "preshot-document-image-button";
            imageButton.addEventListener("click", (event) => {
              event.stopPropagation();
              selectedImageId = image.id;
              controller.onSelectImage(groupId, image.id);
              select();
              editor.view.dispatch(editor.state.tr.setMeta("preshotImageSelection", image.id));
              render();
            });
            imageButton.addEventListener("dblclick", (event) => {
              event.stopPropagation();
              const currentImage = controller.getGroup(groupId)?.images.find(
                (candidate) => candidate.id === image.id,
              );
              controller.onOpenImage(groupId, image.id, currentImage?.file ?? image.file);
            });

            const indexBadge = document.createElement("span");
            indexBadge.ariaHidden = "true";
            indexBadge.className = "preshot-document-image-index";
            indexBadge.textContent = String(index + 1).padStart(2, "0");

            frame.append(imageButton, indexBadge);
            for (const direction of IMAGE_RESIZE_DIRECTIONS) {
              const handle = document.createElement("div");
              const corner = direction.includes("-");
              handle.className = `preshot-document-image-resize-${corner ? "corner" : "edge"} is-${direction}`;
              handle.role = "separator";
              handle.tabIndex = 0;
              handle.ariaLabel = `从${RESIZE_DIRECTION_LABELS[direction]}调整参考图 ${index + 1}`;
              handle.dataset.imageResizeHandle = corner ? "corner" : "edge";
              handle.dataset.imageResizeEdge = direction;
              handle.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                selectedImageId = image.id;
                select();
                activeResizeCleanup?.();
                clearGuides();
                const startX = event.clientX;
                const startY = event.clientY;
                const currentImages = controller.getGroup(groupId)?.images ?? images;
                const currentImage = currentImages.find((candidate) => candidate.id === image.id) ?? image;
                const startWidth = currentImage.frameWidth;
                const startHeight = currentImage.frameHeight;
                const currentFrameScale = Number(frame.dataset.frameScale) || frameScale;
                const candidates = currentImages.filter((candidate) => candidate.id !== image.id);
                let nextFrame = { frameWidth: startWidth, frameHeight: startHeight };
                const move = (moveEvent: PointerEvent) => {
                  const displayScale = safeScale() * currentFrameScale;
                  const dx = (moveEvent.clientX - startX) / displayScale;
                  const dy = (moveEvent.clientY - startY) / displayScale;
                  let frameWidth = Math.max(
                    MIN_DOCUMENT_IMAGE_FRAME,
                    startWidth + (directionAffects(direction, "right") ? dx : directionAffects(direction, "left") ? -dx : 0),
                  );
                  let frameHeight = Math.max(
                    MIN_DOCUMENT_IMAGE_FRAME,
                    startHeight + (directionAffects(direction, "bottom") ? dy : directionAffects(direction, "top") ? -dy : 0),
                  );
                  const snappedWidth = directionAffects(direction, "left") || directionAffects(direction, "right")
                    ? nearestDimension(frameWidth, candidates.map((candidate) => candidate.frameWidth))
                    : null;
                  const snappedHeight = directionAffects(direction, "top") || directionAffects(direction, "bottom")
                    ? nearestDimension(frameHeight, candidates.map((candidate) => candidate.frameHeight))
                    : null;
                  if (snappedWidth !== null) frameWidth = snappedWidth;
                  if (snappedHeight !== null) frameHeight = snappedHeight;
                  nextFrame = { frameWidth, frameHeight };
                  const renderedWidth = frameWidth * currentFrameScale;
                  const renderedHeight = frameHeight * currentFrameScale;
                  frame.style.width = `${renderedWidth}px`;
                  frame.style.height = `${renderedHeight}px`;
                  if (snappedWidth !== null) {
                    verticalGuide.style.left = `${frame.offsetLeft + renderedWidth}px`;
                    verticalGuide.dataset.visible = "true";
                  } else {
                    verticalGuide.removeAttribute("data-visible");
                  }
                  if (snappedHeight !== null) {
                    horizontalGuide.style.top = `${frame.offsetTop + renderedHeight}px`;
                    horizontalGuide.dataset.visible = "true";
                  } else {
                    horizontalGuide.removeAttribute("data-visible");
                  }
                };
                const finish = () => {
                  document.removeEventListener("pointermove", move);
                  document.removeEventListener("pointerup", finish);
                  document.removeEventListener("pointercancel", cancel);
                  activeResizeCleanup = null;
                  clearGuides();
                  controller.onSetImageFrame(groupId, image.id, nextFrame);
                };
                const cancel = () => {
                  document.removeEventListener("pointermove", move);
                  document.removeEventListener("pointerup", finish);
                  document.removeEventListener("pointercancel", cancel);
                  activeResizeCleanup = null;
                  clearGuides();
                  render();
                };
                activeResizeCleanup = cancel;
                document.addEventListener("pointermove", move);
                document.addEventListener("pointerup", finish);
                document.addEventListener("pointercancel", cancel);
              });
              frame.append(handle);
            }
            updateFrameView(frame, image, index, frameScale);
            grid.append(frame);
          });
        };
        dom.addEventListener("pointerdown", (event) => {
          if ((event.target as Element).closest("button, [role=separator]")) return;
          event.stopPropagation();
          selectedImageId = "";
          controller.onSelectImage(groupId, "");
          select();
          editor.view.dispatch(editor.state.tr.setMeta("preshotImageSelection", ""));
          render();
        });

        const startGroupResize = (direction: ResizeDirection) => (event: PointerEvent) => {
          event.preventDefault();
          event.stopPropagation();
          select();
          const group = controller.getGroup(groupId);
          if (!group) return;
          activeResizeCleanup?.();
          const startX = event.clientX;
          const startY = event.clientY;
          const initial = { x: group.x, width: group.width, height: group.height };
          let next = initial;
          const move = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - startX) / safeScale();
            const dy = (moveEvent.clientY - startY) / safeScale();
            let x = initial.x;
            let width = initial.width;
            let height = initial.height;
            if (directionAffects(direction, "left")) {
              width = initial.width - dx;
              width = Math.max(MIN_COMPONENT_WIDTH, Math.min(width, DOCUMENT_CONTENT_WIDTH));
              x = initial.x + initial.width - width;
            } else if (directionAffects(direction, "right")) {
              width = initial.width + dx;
              width = Math.max(MIN_COMPONENT_WIDTH, Math.min(width, DOCUMENT_CONTENT_WIDTH));
            }
            height = initial.height + (
              directionAffects(direction, "bottom")
                ? dy
                : directionAffects(direction, "top")
                  ? -dy
                  : 0
            );
            x = Math.max(0, Math.min(x, DOCUMENT_CONTENT_WIDTH - width));
            height = Math.max(MIN_COMPONENT_HEIGHT, height);
            next = { x, width, height };
            dom.style.marginLeft = `${x}px`;
            dom.style.width = `${width}px`;
            dom.style.height = `${height}px`;
          };
          const finish = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", cancel);
            activeResizeCleanup = null;
            controller.onResizeGroup(groupId, next);
          };
          const cancel = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", cancel);
            activeResizeCleanup = null;
            render();
          };
          activeResizeCleanup = cancel;
          document.addEventListener("pointermove", move);
          document.addEventListener("pointerup", finish);
          document.addEventListener("pointercancel", cancel);
        };
        dom.querySelectorAll<HTMLElement>("[data-group-resize-edge]").forEach((handle) => {
          handle.addEventListener(
            "pointerdown",
            startGroupResize(handle.dataset.groupResizeEdge as ResizeDirection),
          );
        });

        const unregister = controller.registerView(groupId, render);
        const resizeObserver = new ResizeObserver(render);
        resizeObserver.observe(dom);
        render();
        return {
          dom,
          selectNode: () => dom.classList.add("is-selected"),
          deselectNode: () => {
            selectedImageId = "";
            controller.onSelectImage(groupId, "");
            dom.classList.remove("is-selected");
          },
          update: (nextNode: typeof node) => {
            if (nextNode.type !== node.type) return false;
            groupId = decodedGroupId(nextNode.attrs.groupId);
            render();
            return true;
          },
          stopEvent: (event: Event) =>
            event.target instanceof Element &&
            event.target.closest("button, [role=separator]") !== null,
          ignoreMutation: () => true,
          destroy: () => {
            unregister();
            resizeObserver.disconnect();
            activeResizeCleanup?.();
          },
        };
      };
    },
  });
}

export function createBlankLineImageGroupInsertExtension(
  controller: DocumentImageGroupController,
) {
  return Extension.create({
    name: "imageGroupInsertControls",
    addProseMirrorPlugins() {
      return [new Plugin({
        key: blankLineInsertPluginKey,
        state: {
          init: (): BlankLineInsertState => ({ activeOffset: null }),
          apply(transaction, previous) {
            const requested = transaction.getMeta(blankLineInsertPluginKey) as BlankLineInsertState | undefined;
            if (requested) return requested;
            if (previous.activeOffset === null) return previous;
            const mapped = transaction.mapping.mapResult(previous.activeOffset);
            return { activeOffset: mapped.deleted ? null : mapped.pos };
          },
        },
        props: {
          handleClick(view, position) {
            const resolved = view.state.doc.resolve(position);
            let activeOffset: number | null = null;
            for (let depth = resolved.depth; depth > 0; depth -= 1) {
              const node = resolved.node(depth);
              if (node.type.name === "paragraph" && node.content.size === 0) {
                activeOffset = resolved.before(depth);
                break;
              }
            }
            const current = blankLineInsertPluginKey.getState(view.state)?.activeOffset ?? null;
            if (current !== activeOffset) {
              view.dispatch(view.state.tr.setMeta(blankLineInsertPluginKey, { activeOffset }));
            }
            if (activeOffset === null) {
              controller.onActivateBlankLine?.(null);
            } else {
              const coords = view.coordsAtPos(activeOffset + 1);
              controller.onActivateBlankLine?.({
                position: activeOffset,
                left: coords.left,
                top: coords.top,
                bottom: coords.bottom,
              });
            }
            return false;
          },
        },
      })];
    },
  });
}