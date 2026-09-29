import { ui } from "../../../shared/i18n/ui";
import {
  moveBlockRelative,
  type BlockDropPlacement,
  type PreshotBlockNoteEditor,
  type PreshotEditorBlock,
} from "./blockOperations";

interface BlockPointerDragOptions {
  editor: PreshotBlockNoteEditor;
  source: PreshotEditorBlock;
  clientX: number;
  clientY: number;
  notify?(message: string): void;
  onActivate?(): void;
  onFinish?(dragged: boolean): void;
}

function clearDropIndicators() {
  document.querySelectorAll<HTMLElement>("[data-preshot-block-drop]")
    .forEach((element) => {
      delete element.dataset.preshotBlockDrop;
    });
  document.querySelectorAll<HTMLElement>("[data-preshot-block-dragging]")
    .forEach((element) => {
      delete element.dataset.preshotBlockDragging;
    });
  document.querySelectorAll<HTMLElement>("[data-preshot-block-drop-overlay]")
    .forEach((element) => element.remove());
  document.body.classList.remove("preshot-is-dragging-block");
}

function showDropIndicator(
  target: HTMLElement,
  placement: BlockDropPlacement,
) {
  document.querySelectorAll<HTMLElement>("[data-preshot-block-drop-overlay]")
    .forEach((element) => element.remove());
  const rect = target.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.dataset.preshotBlockDropOverlay = placement;
  overlay.className = "preshot-block-drop-overlay";
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  if (placement === "left" || placement === "right") {
    overlay.style.left = `${placement === "left" ? rect.left - 3 : rect.right + 1}px`;
    overlay.style.top = `${rect.top}px`; overlay.style.width = "2px"; overlay.style.height = `${rect.height}px`;
  } else if (placement === "inside") {
    overlay.style.top = `${rect.top}px`;
    overlay.style.height = `${rect.height}px`;
  } else {
    overlay.style.top = `${
      placement === "before" ? rect.top - 1 : rect.bottom - 1
    }px`;
    overlay.style.height = "2px";
  }
  document.body.appendChild(overlay);
}

function isAtomicLayoutBlock(block: PreshotEditorBlock): boolean {
  return block.type === "imageGroup" ||
    block.type === "shootingLocation" ||
    block.type === "modelCard" ||
    block.type === "clothing" ||
    block.type === "prop";
}

function validAtomicLayoutTarget(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): PreshotEditorBlock {
  let current = block;
  for (;;) {
    const parent = editor.getParentBlock(current) as
      | PreshotEditorBlock
      | undefined;
    if (!parent || parent.type === "column") return current;
    current = parent;
  }
}

export function startBlockPointerDrag({
  editor,
  source,
  clientX,
  clientY,
  notify,
  onActivate,
  onFinish,
}: BlockPointerDragOptions): void {
  const editorRoot = editor.prosemirrorView.dom;
  const originalDocument = editor.prosemirrorView.state.doc;
  let dragging = false;
  let finished = false;
  let targetBlock: PreshotEditorBlock | null = null;
  let placement: BlockDropPlacement | null = null;

  const move = (moveEvent: PointerEvent) => {
    if (!editorRoot.isConnected || editorRoot.closest("[inert]") || editor.prosemirrorView.state.doc !== originalDocument) {
      cancel();
      return;
    }
    const distance = Math.hypot(
      moveEvent.clientX - clientX,
      moveEvent.clientY - clientY,
    );
    if (!dragging && distance < 6) return;
    if (!dragging) {
      dragging = true;
      onActivate?.();
      document.body.classList.add("preshot-is-dragging-block");
      editorRoot.querySelector<HTMLElement>(
        `[data-node-type="blockOuter"][data-id="${CSS.escape(source.id)}"]`,
      )?.setAttribute("data-preshot-block-dragging", "true");
    }
    moveEvent.preventDefault();
    document.querySelectorAll<HTMLElement>("[data-preshot-block-drop]")
      .forEach((element) => {
        delete element.dataset.preshotBlockDrop;
      });
    const hit = document.elementFromPoint(
      moveEvent.clientX,
      moveEvent.clientY,
    );
    const outer = hit?.closest<HTMLElement>(
      '[data-node-type="blockOuter"][data-id], .bn-block-column[data-id], .bn-block-column-list[data-id]',
    );
    const targetId = outer && editorRoot.contains(outer) ? outer.dataset.id : undefined;
    let target = targetId
      ? editor.getBlock(targetId) as PreshotEditorBlock | undefined
      : undefined;
    if (!target || target.id === source.id) {
      document.querySelectorAll("[data-preshot-block-drop-overlay]").forEach(element => element.remove());
      targetBlock = null;
      placement = null;
      return;
    }
    if (isAtomicLayoutBlock(source) && target.type !== "column") {
      target = validAtomicLayoutTarget(editor, target);
    }
    const targetOuter = editorRoot.querySelector<HTMLElement>(
      `[data-id="${CSS.escape(target.id)}"]`,
    );
    if (!targetOuter) { targetBlock = null; placement = null; return; }
    const rect = targetOuter.getBoundingClientRect();
    const verticalRatio =
      (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
    const canDropInside =
      !isAtomicLayoutBlock(source) &&
      !isAtomicLayoutBlock(target) &&
      source.type !== "columnList" && target.type !== "columnList" &&
      target.type !== "divider";
    if (target.type === "columnList") {
      placement = verticalRatio < 0.5 ? "before" : "after";
    } else if (target.type === "column") {
      placement = "inside";
    } else if (moveEvent.clientX <= rect.left + 12) {
      placement = "left";
    } else if (moveEvent.clientX >= rect.right - 12) {
      placement = "right";
    } else if (
      canDropInside &&
      verticalRatio >= 0.3 &&
      verticalRatio <= 0.7 &&
      moveEvent.clientX > rect.left + 36
    ) {
      placement = "inside";
    } else {
      placement = verticalRatio < 0.5 ? "before" : "after";
    }
    targetBlock = target;
    targetOuter.dataset.preshotBlockDrop = placement;
    showDropIndicator(targetOuter, placement);
  };

  const finish = (event?: PointerEvent) => {
    if (finished) return;
    if (event && dragging) move(event);
    // Release rechecks the live target and can cancel a stale document.
    if (finished) return;
    finished = true;
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    clearDropIndicators();
    if (
      dragging &&
      editorRoot.isConnected &&
      !editorRoot.closest("[inert]") &&
      targetBlock &&
      placement &&
      moveBlockRelative(editor, source, targetBlock, placement)
    ) {
      if (source.type !== "columnList") editor.setTextCursorPosition(source.id, "start");
      editor.focus();
      notify?.(
        placement === "inside"
          ? ui("Block 已移动并嵌套")
          : ui("Block 已移动"),
      );
    }
    onFinish?.(dragging);
  };

  const cancel = () => {
    targetBlock = null;
    placement = null;
    finish();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
  document.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
}
