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
    overlay.style.left = `${
      placement === "left" ? rect.left - 1 : rect.right - 1
    }px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = "2px";
    overlay.style.height = `${rect.height}px`;
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

function validImageGroupTarget(
  editor: PreshotBlockNoteEditor,
  block: PreshotEditorBlock,
): PreshotEditorBlock {
  let current = block;
  for (;;) {
    const parent = editor.getParentBlock(current) as
      | PreshotEditorBlock
      | undefined;
    if (!parent) return current;
    if (parent.type === "column") return current;
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
  let dragging = false;
  let targetBlock: PreshotEditorBlock | null = null;
  let placement: BlockDropPlacement | null = null;

  const move = (moveEvent: PointerEvent) => {
    const distance = Math.hypot(
      moveEvent.clientX - clientX,
      moveEvent.clientY - clientY,
    );
    if (!dragging && distance < 6) return;
    if (!dragging) {
      dragging = true;
      onActivate?.();
      document.body.classList.add("preshot-is-dragging-block");
      document.querySelector<HTMLElement>(
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
      '[data-node-type="blockOuter"][data-id]',
    );
    const targetId = outer?.dataset.id;
    let target = targetId
      ? editor.getBlock(targetId) as PreshotEditorBlock | undefined
      : undefined;
    if (!target || target.id === source.id) {
      targetBlock = null;
      placement = null;
      return;
    }
    if (source.type === "imageGroup") {
      target = validImageGroupTarget(editor, target);
    }
    const targetOuter = document.querySelector<HTMLElement>(
      `[data-node-type="blockOuter"][data-id="${CSS.escape(target.id)}"]`,
    );
    if (!targetOuter) return;
    const rect = targetOuter.getBoundingClientRect();
    const verticalRatio =
      (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
    const horizontalRatio =
      (moveEvent.clientX - rect.left) / Math.max(1, rect.width);
    const canDropInside =
      source.type !== "imageGroup" &&
      target.type !== "imageGroup" &&
      target.type !== "divider";
    if (horizontalRatio <= 0.2) {
      placement = "left";
    } else if (horizontalRatio >= 0.8) {
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

  const finish = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", cancel);
    clearDropIndicators();
    if (
      dragging &&
      targetBlock &&
      placement &&
      moveBlockRelative(editor, source, targetBlock, placement)
    ) {
      notify?.(
        placement === "inside"
          ? "Block 已移动并嵌套"
          : placement === "left" || placement === "right"
            ? "Block 已移动到同一行"
            : "Block 已移动",
      );
    }
    onFinish?.(dragging);
  };

  const cancel = () => {
    targetBlock = null;
    placement = null;
    finish();
  };

  document.addEventListener("pointermove", move, { passive: false });
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", cancel);
}
