import { Extension, Node, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { ReferenceComponent } from "../../domain/plan/canvas/models";
import { MIN_COMPONENT_HEIGHT, MIN_COMPONENT_WIDTH } from "../../domain/plan/canvas/models";
import { contentSize, DEFAULT_PAGE_GEOMETRY } from "../../domain/plan/canvas/geometry";
import { layoutDocumentImageGroup } from "../../domain/plan/canvas/documentImageGroupLayout";
import { imageCropForView, imageViewCss } from "../../domain/plan/canvas/imageView";
import { IMAGE_GROUP_NODE_NAME } from "../../domain/plan/canvas/document";
import type { MoveImageParams } from "../../domain/plan/canvas/plan";

export interface DocumentImageGroupController {
  getGroup(id: string): ReferenceComponent | undefined;
  getImageSrc(file: string): string | undefined;
  getSelectedImageId(groupId: string): string;
  createGroup(): string | null;
  onAddImages(id: string): void;
  onOpenImage(componentId: string, imageId: string, file: string): void;
  onRemoveImage(componentId: string, imageId: string): void;
  onRequestRemoveImage(componentId: string, imageId: string): void;
  onMoveImage(params: MoveImageParams): void;
  onRemoveGroup(id: string): void;
  onResizeGroup(
    id: string,
    rect: {
      x?: number;
      width?: number;
      height?: number;
      frameOffsetY?: number;
    },
  ): void;
  onSetImageFrame(
    componentId: string,
    imageId: string,
    frame: {
      frameWidth: number;
      frameHeight: number;
      frameOffsetX?: number;
      frameOffsetY?: number;
    },
  ): void;
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
const IMAGE_SNAP_ENTER_PX = 6;
const IMAGE_SNAP_RELEASE_PX = 10;
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

interface SnapCandidate<T> {
  key: string;
  value: number;
  priority: number;
  data: T;
}

function nearestSnap<T>(
  value: number,
  candidates: readonly SnapCandidate<T>[],
  activeKey: string | null,
): (SnapCandidate<T> & { distance: number }) | null {
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.value - value),
    }))
    .filter((candidate) =>
      candidate.distance <= (
        candidate.key === activeKey
          ? IMAGE_SNAP_RELEASE_PX
          : IMAGE_SNAP_ENTER_PX
      ),
    )
    .sort((left, right) =>
      left.priority - right.priority ||
      left.distance - right.distance,
    )[0] ?? null;
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
        const verticalGuideLabel = document.createElement("div");
        verticalGuideLabel.className =
          "preshot-document-image-guide-label is-vertical";
        const horizontalGuideLabel = document.createElement("div");
        horizontalGuideLabel.className =
          "preshot-document-image-guide-label is-horizontal";
        const widthBracket = document.createElement("div");
        widthBracket.className =
          "preshot-document-image-dimension-bracket is-width";
        const heightBracket = document.createElement("div");
        heightBracket.className =
          "preshot-document-image-dimension-bracket is-height";
        const dimensionLabel = document.createElement("div");
        dimensionLabel.className = "preshot-document-image-dimension-label";

        dom.append(
          grid,
          empty,
          verticalGuide,
          horizontalGuide,
          verticalGuideLabel,
          horizontalGuideLabel,
          widthBracket,
          heightBracket,
          dimensionLabel,
        );

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
          [
            verticalGuide,
            horizontalGuide,
            verticalGuideLabel,
            horizontalGuideLabel,
            widthBracket,
            heightBracket,
            dimensionLabel,
          ].forEach((element) => element.removeAttribute("data-visible"));
        };

        const clearImageDropTargets = () => {
          editor.view.dom
            .querySelectorAll<HTMLElement>(".preshot-document-image-group.is-image-drop-target")
            .forEach((group) => group.classList.remove("is-image-drop-target"));
        };

        const topLevelDropPosition = (clientY: number): {
          position: number;
          rect: DOMRect;
        } => {
          const sourcePosition = getPos();
          let result = {
            position: editor.state.doc.content.size,
            rect: editor.view.dom.getBoundingClientRect(),
          };
          let found = false;
          editor.state.doc.forEach((_child, offset) => {
            if (found || offset === sourcePosition) return;
            const nodeDom = editor.view.nodeDOM(offset);
            const element = nodeDom instanceof HTMLElement
              ? nodeDom
              : nodeDom?.parentElement;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            result = { position: offset + _child.nodeSize, rect };
            if (clientY < rect.top + rect.height / 2) {
              result = { position: offset, rect };
              found = true;
            }
          });
          return result;
        };

        const selectGroupById = (targetGroupId: string) => {
          let targetPosition: number | null = null;
          editor.state.doc.forEach((child, offset) => {
            if (
              targetPosition === null &&
              child.type.name === IMAGE_GROUP_NODE_NAME &&
              decodedGroupId(child.attrs.groupId) === targetGroupId
            ) {
              targetPosition = offset;
            }
          });
          if (targetPosition !== null) {
            editor.view.dispatch(
              editor.state.tr.setSelection(
                NodeSelection.create(editor.state.doc, targetPosition),
              ),
            );
          }
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
          frame.dataset.frameOffsetX = String(image.frameOffsetX ?? 0);
          frame.dataset.frameOffsetY = String(image.frameOffsetY ?? 0);
          frame.classList.toggle("is-selected", selectedImageId === image.id);
          frame.style.width = `${Math.max(1, image.frameWidth * frameScale)}px`;
          frame.style.height = `${Math.max(1, image.frameHeight * frameScale)}px`;
          frame.style.marginLeft = `${(image.frameOffsetX ?? 0) * frameScale}px`;
          frame.style.marginTop = `${(image.frameOffsetY ?? 0) * frameScale}px`;
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
          const deleteButton = frame.querySelector<HTMLButtonElement>(
            ".preshot-document-image-delete",
          );
          if (deleteButton) deleteButton.ariaLabel = `删除参考图 ${index + 1}`;
        };

        const render = () => {
          selectedImageId = controller.getSelectedImageId(groupId);
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
          const groupFrameOffsetY = group?.frameOffsetY ?? 0;
          dom.style.width = `${groupWidth}px`;
          dom.style.height = `${groupHeight}px`;
          dom.style.marginLeft = `${groupX}px`;
          dom.style.translate = `0 ${groupFrameOffsetY}px`;
          dom.style.marginBottom = `calc(0.65rem + ${groupFrameOffsetY}px)`;
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
            imageButton.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              selectedImageId = image.id;
              controller.onSelectImage(groupId, image.id);
              select();
              editor.view.dispatch(editor.state.tr.setMeta("preshotImageSelection", image.id));
              render();

              activeResizeCleanup?.();
              const startX = event.clientX;
              const startY = event.clientY;
              const sourceGroupId = groupId;
              const sourceGrid = frame.parentElement as HTMLElement;
              const frameRect = frame.getBoundingClientRect();
              const originalWidth = frame.style.width;
              const originalHeight = frame.style.height;
              const originMarker = document.createComment("preshot-image-origin");
              let placeholder: HTMLElement | null = null;
              let targetGrid: HTMLElement | null = null;
              let dragging = false;

              const activate = () => {
                dragging = true;
                placeholder = document.createElement("div");
                placeholder.className = "preshot-document-image-drop-placeholder";
                placeholder.style.width = `${frameRect.width / safeScale()}px`;
                placeholder.style.height = `${frameRect.height / safeScale()}px`;
                sourceGrid.insertBefore(originMarker, frame);
                sourceGrid.insertBefore(placeholder, frame);
                document.body.append(frame);
                frame.classList.add("is-dragging");
                Object.assign(frame.style, {
                  height: `${frameRect.height}px`,
                  left: `${frameRect.left}px`,
                  position: "fixed",
                  top: `${frameRect.top}px`,
                  width: `${frameRect.width}px`,
                });
              };

              const targetAt = (clientX: number, clientY: number) => {
                const target = document.elementFromPoint(clientX, clientY);
                return target?.closest<HTMLElement>(".preshot-document-image-group-grid") ??
                  target?.closest<HTMLElement>(".preshot-document-image-group")
                    ?.querySelector<HTMLElement>(".preshot-document-image-group-grid") ??
                  null;
              };

              const movePlaceholder = (
                destination: HTMLElement,
                clientX: number,
                clientY: number,
              ) => {
                const candidates = Array.from(
                  destination.querySelectorAll<HTMLElement>(".preshot-document-image-frame"),
                ).filter((candidate) => candidate !== frame);
                const before = candidates.find((candidate) => {
                  const rect = candidate.getBoundingClientRect();
                  const sameRow = clientY >= rect.top && clientY <= rect.bottom;
                  return clientY < rect.top + rect.height / 2 ||
                    (sameRow && clientX < rect.left + rect.width / 2);
                });
                destination.insertBefore(placeholder!, before ?? null);
              };

              const move = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!dragging && Math.hypot(dx, dy) < 6) return;
                if (!dragging) activate();
                frame.style.left = `${frameRect.left + dx}px`;
                frame.style.top = `${frameRect.top + dy}px`;
                clearImageDropTargets();
                targetGrid = targetAt(moveEvent.clientX, moveEvent.clientY);
                if (!targetGrid) return;
                targetGrid.closest(".preshot-document-image-group")
                  ?.classList.add("is-image-drop-target");
                movePlaceholder(targetGrid, moveEvent.clientX, moveEvent.clientY);
              };

              const cleanup = () => {
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", finish);
                document.removeEventListener("pointercancel", cancel);
                clearImageDropTargets();
                frame.classList.remove("is-dragging");
                frame.style.removeProperty("left");
                frame.style.removeProperty("position");
                frame.style.removeProperty("top");
                frame.style.width = originalWidth;
                frame.style.height = originalHeight;
                originMarker.remove();
                placeholder?.remove();
                activeResizeCleanup = null;
              };

              const finish = () => {
                if (!dragging) {
                  cleanup();
                  const currentImage = controller.getGroup(groupId)?.images.find(
                    (candidate) => candidate.id === image.id,
                  );
                  controller.onOpenImage(
                    groupId,
                    image.id,
                    currentImage?.file ?? image.file,
                  );
                  return;
                }
                if (!targetGrid || !placeholder) {
                  sourceGrid.insertBefore(frame, originMarker.nextSibling);
                  cleanup();
                  render();
                  return;
                }
                targetGrid.insertBefore(frame, placeholder);
                const targetGroup = targetGrid.closest<HTMLElement>(
                  ".preshot-document-image-group",
                );
                const targetGroupId = targetGroup?.dataset.imageGroupId ?? sourceGroupId;
                const toIndex = Array.from(
                  targetGrid.querySelectorAll<HTMLElement>(
                    ".preshot-document-image-frame",
                  ),
                ).indexOf(frame);
                cleanup();
                controller.onSelectImage(targetGroupId, image.id);
                controller.onMoveImage({
                  fromComponentId: sourceGroupId,
                  imageId: image.id,
                  toComponentId: targetGroupId,
                  toIndex: Math.max(0, toIndex),
                });
                selectGroupById(targetGroupId);
              };

              const cancel = () => {
                if (dragging) sourceGrid.insertBefore(frame, originMarker.nextSibling);
                cleanup();
                render();
              };

              activeResizeCleanup = cancel;
              document.addEventListener("pointermove", move);
              document.addEventListener("pointerup", finish);
              document.addEventListener("pointercancel", cancel);
            });
            imageButton.addEventListener("click", (event) => {
              if (event.detail !== 0) return;
              event.stopPropagation();
              selectedImageId = image.id;
              controller.onSelectImage(groupId, image.id);
              select();
              editor.view.dispatch(
                editor.state.tr.setMeta("preshotImageSelection", image.id),
              );
              render();
              const currentImage = controller.getGroup(groupId)?.images.find(
                (candidate) => candidate.id === image.id,
              );
              controller.onOpenImage(
                groupId,
                image.id,
                currentImage?.file ?? image.file,
              );
            });

            const indexBadge = document.createElement("span");
            indexBadge.ariaHidden = "true";
            indexBadge.className = "preshot-document-image-index";
            indexBadge.textContent = String(index + 1).padStart(2, "0");

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "preshot-document-image-delete";
            deleteButton.ariaLabel = `删除参考图 ${index + 1}`;
            deleteButton.title = "删除图片";
            deleteButton.innerHTML =
              '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14"/></svg>';
            deleteButton.addEventListener("pointerdown", (event) => {
              event.preventDefault();
              event.stopPropagation();
            });
            deleteButton.addEventListener("click", (event) => {
              event.stopPropagation();
              selectedImageId = image.id;
              controller.onSelectImage(groupId, image.id);
              select();
              controller.onRequestRemoveImage(groupId, image.id);
            });

            frame.append(imageButton, indexBadge, deleteButton);
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
                const startOffsetX = currentImage.frameOffsetX ?? 0;
                const startOffsetY = currentImage.frameOffsetY ?? 0;
                const currentFrameScale = Number(frame.dataset.frameScale) || frameScale;
                const groupRect = dom.getBoundingClientRect();
                const startFrameRect = frame.getBoundingClientRect();
                const frozenCandidates = currentImages
                  .filter((candidate) => candidate.id !== image.id)
                  .flatMap((candidate) => {
                    const candidateFrame = grid.querySelector<HTMLElement>(
                      `[data-image-id="${CSS.escape(candidate.id)}"]`,
                    );
                    if (!candidateFrame) return [];
                    const rect = candidateFrame.getBoundingClientRect();
                    return [{
                      id: candidate.id,
                      frameWidth: candidate.frameWidth,
                      frameHeight: candidate.frameHeight,
                      left: rect.left,
                      right: rect.right,
                      top: rect.top,
                      bottom: rect.bottom,
                      centerX: rect.left + rect.width / 2,
                      centerY: rect.top + rect.height / 2,
                    }];
                  });
                let widthSnapKey: string | null = null;
                let heightSnapKey: string | null = null;
                let verticalSnapKey: string | null = null;
                let horizontalSnapKey: string | null = null;
                let previewFrame = 0;
                let nextFrame = {
                  frameWidth: startWidth,
                  frameHeight: startHeight,
                  frameOffsetX: startOffsetX,
                  frameOffsetY: startOffsetY,
                };
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
                  const widthSnap = directionAffects(direction, "left") ||
                      directionAffects(direction, "right")
                    ? nearestSnap(
                        frameWidth * displayScale,
                        frozenCandidates.map((candidate) => ({
                          key: `width:${candidate.id}`,
                          value: candidate.frameWidth * displayScale,
                          priority: 0,
                          data: candidate,
                        })),
                        widthSnapKey,
                      )
                    : null;
                  const heightSnap = directionAffects(direction, "top") ||
                      directionAffects(direction, "bottom")
                    ? nearestSnap(
                        frameHeight * displayScale,
                        frozenCandidates.map((candidate) => ({
                          key: `height:${candidate.id}`,
                          value: candidate.frameHeight * displayScale,
                          priority: 0,
                          data: candidate,
                        })),
                        heightSnapKey,
                      )
                    : null;
                  widthSnapKey = widthSnap?.key ?? null;
                  heightSnapKey = heightSnap?.key ?? null;
                  if (widthSnap) frameWidth = widthSnap.data.frameWidth;
                  if (heightSnap) frameHeight = heightSnap.data.frameHeight;

                  const screenRect = () => {
                    const width = frameWidth * displayScale;
                    const height = frameHeight * displayScale;
                    const left = directionAffects(direction, "left")
                      ? startFrameRect.right - width
                      : startFrameRect.left;
                    const top = directionAffects(direction, "top")
                      ? startFrameRect.bottom - height
                      : startFrameRect.top;
                    return {
                      left,
                      right: left + width,
                      top,
                      bottom: top + height,
                      width,
                      height,
                    };
                  };

                  let activeRect = screenRect();
                  let verticalSnap: ReturnType<typeof nearestSnap<{
                    id: string;
                    label: string;
                    rect: (typeof frozenCandidates)[number];
                  }>> = null;
                  let horizontalSnap: ReturnType<typeof nearestSnap<{
                    id: string;
                    label: string;
                    rect: (typeof frozenCandidates)[number];
                  }>> = null;
                  if (!widthSnap && (
                    directionAffects(direction, "left") ||
                    directionAffects(direction, "right")
                  )) {
                    const movingX = directionAffects(direction, "left")
                      ? activeRect.left
                      : activeRect.right;
                    verticalSnap = nearestSnap(
                      movingX,
                      frozenCandidates.flatMap((candidate) => [
                        {
                          key: `x:${candidate.id}:left`,
                          value: candidate.left,
                          priority: 1,
                          data: { id: candidate.id, label: "左边对齐", rect: candidate },
                        },
                        {
                          key: `x:${candidate.id}:right`,
                          value: candidate.right,
                          priority: 1,
                          data: { id: candidate.id, label: "右边对齐", rect: candidate },
                        },
                        {
                          key: `x:${candidate.id}:center`,
                          value: candidate.centerX,
                          priority: 2,
                          data: { id: candidate.id, label: "水平中心", rect: candidate },
                        },
                      ]),
                      verticalSnapKey,
                    );
                    verticalSnapKey = verticalSnap?.key ?? null;
                    if (verticalSnap) {
                      const correction = verticalSnap.value - movingX;
                      frameWidth = Math.max(
                        MIN_DOCUMENT_IMAGE_FRAME,
                        frameWidth + (
                          directionAffects(direction, "left")
                            ? -correction / displayScale
                            : correction / displayScale
                        ),
                      );
                      activeRect = screenRect();
                    }
                  } else {
                    verticalSnapKey = null;
                  }
                  if (!heightSnap && (
                    directionAffects(direction, "top") ||
                    directionAffects(direction, "bottom")
                  )) {
                    const movingY = directionAffects(direction, "top")
                      ? activeRect.top
                      : activeRect.bottom;
                    horizontalSnap = nearestSnap(
                      movingY,
                      frozenCandidates.flatMap((candidate) => [
                        {
                          key: `y:${candidate.id}:top`,
                          value: candidate.top,
                          priority: 1,
                          data: { id: candidate.id, label: "上边对齐", rect: candidate },
                        },
                        {
                          key: `y:${candidate.id}:bottom`,
                          value: candidate.bottom,
                          priority: 1,
                          data: { id: candidate.id, label: "下边对齐", rect: candidate },
                        },
                        {
                          key: `y:${candidate.id}:center`,
                          value: candidate.centerY,
                          priority: 2,
                          data: { id: candidate.id, label: "垂直中心", rect: candidate },
                        },
                      ]),
                      horizontalSnapKey,
                    );
                    horizontalSnapKey = horizontalSnap?.key ?? null;
                    if (horizontalSnap) {
                      const correction = horizontalSnap.value - movingY;
                      frameHeight = Math.max(
                        MIN_DOCUMENT_IMAGE_FRAME,
                        frameHeight + (
                          directionAffects(direction, "top")
                            ? -correction / displayScale
                            : correction / displayScale
                        ),
                      );
                      activeRect = screenRect();
                    }
                  } else {
                    horizontalSnapKey = null;
                  }

                  const frameOffsetX = directionAffects(direction, "left")
                    ? startOffsetX + startWidth - frameWidth
                    : startOffsetX;
                  const frameOffsetY = directionAffects(direction, "top")
                    ? startOffsetY + startHeight - frameHeight
                    : startOffsetY;
                  nextFrame = {
                    frameWidth,
                    frameHeight,
                    frameOffsetX,
                    frameOffsetY,
                  };
                  cancelAnimationFrame(previewFrame);
                  previewFrame = requestAnimationFrame(() => {
                    const renderedWidth = frameWidth * currentFrameScale;
                    const renderedHeight = frameHeight * currentFrameScale;
                    frame.style.width = `${renderedWidth}px`;
                    frame.style.height = `${renderedHeight}px`;
                    frame.style.marginLeft = `${frameOffsetX * currentFrameScale}px`;
                    frame.style.marginTop = `${frameOffsetY * currentFrameScale}px`;
                    clearGuides();

                    const groupScale = safeScale();
                    const toGroupX = (screenX: number) =>
                      (screenX - groupRect.left) / groupScale;
                    const toGroupY = (screenY: number) =>
                      (screenY - groupRect.top) / groupScale;
                    if (verticalSnap) {
                      const candidate = verticalSnap.data.rect;
                      const top = Math.min(activeRect.top, candidate.top) - 6;
                      const bottom = Math.max(activeRect.bottom, candidate.bottom) + 6;
                      verticalGuide.style.left = `${toGroupX(verticalSnap.value)}px`;
                      verticalGuide.style.top = `${toGroupY(top)}px`;
                      verticalGuide.style.height = `${(bottom - top) / groupScale}px`;
                      verticalGuide.dataset.visible = "true";
                      verticalGuideLabel.textContent = verticalSnap.data.label;
                      verticalGuideLabel.style.left =
                        `${toGroupX(verticalSnap.value) + 6}px`;
                      verticalGuideLabel.style.top =
                        `${toGroupY(top) + 7}px`;
                      verticalGuideLabel.dataset.visible = "true";
                    }
                    if (horizontalSnap) {
                      const candidate = horizontalSnap.data.rect;
                      const left = Math.min(activeRect.left, candidate.left) - 6;
                      const right = Math.max(activeRect.right, candidate.right) + 6;
                      horizontalGuide.style.left = `${toGroupX(left)}px`;
                      horizontalGuide.style.top = `${toGroupY(horizontalSnap.value)}px`;
                      horizontalGuide.style.width = `${(right - left) / groupScale}px`;
                      horizontalGuide.dataset.visible = "true";
                      horizontalGuideLabel.textContent = horizontalSnap.data.label;
                      horizontalGuideLabel.style.left = `${toGroupX(left) + 7}px`;
                      horizontalGuideLabel.style.top =
                        `${toGroupY(horizontalSnap.value) + 6}px`;
                      horizontalGuideLabel.dataset.visible = "true";
                    }

                    const dimensionParts: string[] = [];
                    if (widthSnap) {
                      widthBracket.style.left = `${toGroupX(activeRect.left)}px`;
                      widthBracket.style.top = `${toGroupY(activeRect.bottom) + 7}px`;
                      widthBracket.style.width = `${activeRect.width / groupScale}px`;
                      widthBracket.dataset.visible = "true";
                      dimensionParts.push(`同宽 ${Math.round(frameWidth)}`);
                    }
                    if (heightSnap) {
                      heightBracket.style.left = `${toGroupX(activeRect.right) + 7}px`;
                      heightBracket.style.top = `${toGroupY(activeRect.top)}px`;
                      heightBracket.style.height = `${activeRect.height / groupScale}px`;
                      heightBracket.dataset.visible = "true";
                      dimensionParts.push(`同高 ${Math.round(frameHeight)}`);
                    }
                    if (dimensionParts.length > 0) {
                      dimensionLabel.textContent = dimensionParts.join(" · ");
                      if (heightSnap && !widthSnap) {
                        dimensionLabel.style.left =
                          `${toGroupX(activeRect.right) + 18}px`;
                        dimensionLabel.style.top =
                          `${toGroupY(activeRect.top + activeRect.height / 2)}px`;
                        dimensionLabel.style.transform = "translateY(-50%)";
                      } else {
                        dimensionLabel.style.left =
                          `${toGroupX(activeRect.left + activeRect.width / 2)}px`;
                        dimensionLabel.style.top =
                          `${toGroupY(activeRect.bottom) + 18}px`;
                        dimensionLabel.style.transform = "translateX(-50%)";
                      }
                      dimensionLabel.dataset.visible = "true";
                    }
                  });
                };
                const finish = () => {
                  cancelAnimationFrame(previewFrame);
                  document.removeEventListener("pointermove", move);
                  document.removeEventListener("pointerup", finish);
                  document.removeEventListener("pointercancel", cancel);
                  activeResizeCleanup = null;
                  clearGuides();
                  controller.onSetImageFrame(groupId, image.id, nextFrame);
                };
                const cancel = () => {
                  cancelAnimationFrame(previewFrame);
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
          const target = event.target;
          if (!(target instanceof Element) || event.button !== 0) return;
          if (
            target.closest(
              "button, [role=separator], .preshot-document-image-frame",
            )
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          selectedImageId = "";
          controller.onSelectImage(groupId, "");
          select();
          editor.view.dispatch(editor.state.tr.setMeta("preshotImageSelection", ""));
          render();

          activeResizeCleanup?.();
          const startX = event.clientX;
          const startY = event.clientY;
          const groupFrameOffsetY =
            controller.getGroup(groupId)?.frameOffsetY ?? 0;
          const dropIndicator = document.createElement("div");
          dropIndicator.className = "preshot-document-group-drop-indicator";
          let dragging = false;
          let dropPosition = getPos() ?? 0;

          const move = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            if (!dragging && Math.hypot(dx, dy) < 6) return;
            if (!dragging) {
              dragging = true;
              dom.classList.add("is-dragging");
              document.body.append(dropIndicator);
            }
            dom.style.translate =
              `0 ${groupFrameOffsetY + dy / safeScale()}px`;
            const targetDrop = topLevelDropPosition(moveEvent.clientY);
            dropPosition = targetDrop.position;
            const editorRect = editor.view.dom.getBoundingClientRect();
            const top = dropPosition >= editor.state.doc.content.size
              ? targetDrop.rect.bottom
              : targetDrop.rect.top;
            Object.assign(dropIndicator.style, {
              left: `${editorRect.left}px`,
              top: `${top}px`,
              width: `${editorRect.width}px`,
            });
          };

          const cleanup = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", cancel);
            dom.classList.remove("is-dragging");
            dom.style.translate = `0 ${groupFrameOffsetY}px`;
            dropIndicator.remove();
            activeResizeCleanup = null;
          };

          const finish = () => {
            const sourcePosition = getPos();
            if (!dragging || sourcePosition === undefined) {
              cleanup();
              return;
            }
            const currentNode = editor.state.doc.nodeAt(sourcePosition);
            if (!currentNode || currentNode.type.name !== IMAGE_GROUP_NODE_NAME) {
              cleanup();
              return;
            }
            let insertionPosition = dropPosition;
            if (insertionPosition > sourcePosition) {
              insertionPosition -= currentNode.nodeSize;
            }
            insertionPosition = Math.max(
              0,
              Math.min(insertionPosition, editor.state.doc.content.size - currentNode.nodeSize),
            );
            cleanup();
            if (insertionPosition === sourcePosition) return;
            const transaction = editor.state.tr
              .delete(sourcePosition, sourcePosition + currentNode.nodeSize)
              .insert(insertionPosition, currentNode);
            transaction.setSelection(
              NodeSelection.create(transaction.doc, insertionPosition),
            );
            editor.view.dispatch(transaction);
          };

          const cancel = () => cleanup();
          activeResizeCleanup = cancel;
          document.addEventListener("pointermove", move);
          document.addEventListener("pointerup", finish);
          document.addEventListener("pointercancel", cancel);
        });

        const startGroupResize = (direction: ResizeDirection) => (event: PointerEvent) => {
          event.preventDefault();
          event.stopPropagation();
          selectedImageId = "";
          controller.onSelectImage(groupId, "");
          select();
          editor.view.dispatch(editor.state.tr.setMeta("preshotImageSelection", ""));
          const group = controller.getGroup(groupId);
          if (!group) return;
          activeResizeCleanup?.();
          const startX = event.clientX;
          const startY = event.clientY;
          const initialRect = dom.getBoundingClientRect();
          const previousRect = dom.previousElementSibling?.getBoundingClientRect();
          const availableUp = (
            initialRect.height === 0 &&
            initialRect.width === 0
          )
            ? Number.POSITIVE_INFINITY
            : Math.max(
                0,
                (initialRect.top - (previousRect?.bottom ?? editor.view.dom.getBoundingClientRect().top)) /
                  safeScale(),
              );
          const initial = {
            x: group.x,
            width: group.width,
            height: group.height,
            frameOffsetY: group.frameOffsetY ?? 0,
          };
          let next = initial;
          const preview = document.createElement("div");
          preview.dataset.groupResizePreview = "";
          preview.className = "preshot-document-image-group-resize-preview";
          document.body.append(preview);
          const updatePreview = () => {
            const scale = safeScale();
            const left = initialRect.left + (next.x - initial.x) * scale;
            const top =
              initialRect.top +
              (next.frameOffsetY - initial.frameOffsetY) * scale;
            Object.assign(preview.style, {
              height: `${next.height * scale}px`,
              left: `${left}px`,
              top: `${top}px`,
              width: `${next.width * scale}px`,
            });
            preview.dataset.size =
              `${Math.round(next.width)} × ${Math.round(next.height)}`;
          };
          updatePreview();
          const move = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - startX) / safeScale();
            const dy = (moveEvent.clientY - startY) / safeScale();
            let x = initial.x;
            let width = initial.width;
            let height = initial.height;
            let frameOffsetY = initial.frameOffsetY;
            if (directionAffects(direction, "left")) {
              width = initial.width - dx;
              width = Math.max(MIN_COMPONENT_WIDTH, Math.min(width, DOCUMENT_CONTENT_WIDTH));
              x = initial.x + initial.width - width;
            } else if (directionAffects(direction, "right")) {
              width = initial.width + dx;
              width = Math.max(MIN_COMPONENT_WIDTH, Math.min(width, DOCUMENT_CONTENT_WIDTH));
            }
            if (directionAffects(direction, "top")) {
              const minimumOffset = initial.frameOffsetY - availableUp;
              const maximumOffset =
                initial.frameOffsetY + initial.height - MIN_COMPONENT_HEIGHT;
              frameOffsetY = Math.max(
                minimumOffset,
                Math.min(maximumOffset, initial.frameOffsetY + dy),
              );
              height =
                initial.height - (frameOffsetY - initial.frameOffsetY);
            } else if (directionAffects(direction, "bottom")) {
              height = initial.height + dy;
            }
            x = Math.max(0, Math.min(x, DOCUMENT_CONTENT_WIDTH - width));
            height = Math.max(MIN_COMPONENT_HEIGHT, height);
            next = { x, width, height, frameOffsetY };
            updatePreview();
          };
          const finish = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", cancel);
            activeResizeCleanup = null;
            preview.remove();
            controller.onResizeGroup(groupId, next);
          };
          const cancel = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", cancel);
            activeResizeCleanup = null;
            preview.remove();
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