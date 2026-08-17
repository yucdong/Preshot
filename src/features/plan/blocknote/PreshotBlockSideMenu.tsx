import { SideMenuExtension } from "@blocknote/core/extensions";
import { GripVertical } from "lucide-react";
import {
  AddBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { BlockOperationsMenu } from "./BlockOperationsMenu";
import {
  moveBlockRelative,
  type BlockDropPlacement,
  type PreshotEditorBlock,
} from "./blockOperations";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";
import { preshotBlockNoteSchema } from "./blockNoteSchema";

interface PreshotBlockSideMenuProps {
  controller: ImageGroupBlockController;
  notify(message: string): void;
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
  if (placement === "inside") {
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

function topLevelBlock(
  editor: typeof preshotBlockNoteSchema.BlockNoteEditor,
  block: PreshotEditorBlock,
): PreshotEditorBlock {
  let current = block;
  for (;;) {
    const parent = editor.getParentBlock(current) as
      | PreshotEditorBlock
      | undefined;
    if (!parent) return current;
    current = parent;
  }
}

export function PreshotBlockSideMenu({
  controller,
  notify,
}: PreshotBlockSideMenuProps) {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor<
    typeof preshotBlockNoteSchema.blockSchema,
    typeof preshotBlockNoteSchema.inlineContentSchema,
    typeof preshotBlockNoteSchema.styleSchema
  >();
  const sideMenu = useExtension(SideMenuExtension);
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  }) as PreshotEditorBlock | undefined;
  const suppressClickRef = useRef(false);

  if (!Components || !block) return null;

  const startPointerDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let targetBlock: PreshotEditorBlock | null = null;
    let placement: BlockDropPlacement | null = null;

    const move = (moveEvent: PointerEvent) => {
      const distance = Math.hypot(
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      );
      if (!dragging && distance < 6) return;
      if (!dragging) {
        dragging = true;
        suppressClickRef.current = true;
        sideMenu.freezeMenu();
        document.body.classList.add("preshot-is-dragging-block");
        document.querySelector<HTMLElement>(
          `[data-node-type="blockOuter"][data-id="${CSS.escape(block.id)}"]`,
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
      if (!target || target.id === block.id) {
        targetBlock = null;
        placement = null;
        return;
      }
      if (block.type === "imageGroup") {
        target = topLevelBlock(editor, target);
      }
      const targetOuter = document.querySelector<HTMLElement>(
        `[data-node-type="blockOuter"][data-id="${CSS.escape(target.id)}"]`,
      );
      if (!targetOuter) return;
      const rect = targetOuter.getBoundingClientRect();
      const ratio = (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
      const canDropInside =
        block.type !== "imageGroup" &&
        target.type !== "imageGroup" &&
        target.type !== "divider";
      if (
        canDropInside &&
        ratio >= 0.3 &&
        ratio <= 0.7 &&
        moveEvent.clientX > rect.left + 36
      ) {
        placement = "inside";
      } else {
        placement = ratio < 0.5 ? "before" : "after";
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
        moveBlockRelative(editor, block, targetBlock, placement)
      ) {
        notify(
          placement === "inside"
            ? "Block 已移动并嵌套"
            : "Block 已移动",
        );
      }
      if (dragging) sideMenu.unfreezeMenu();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const cancel = () => {
      targetBlock = null;
      placement = null;
      finish();
    };

    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
  };

  return (
    <Components.SideMenu.Root className="bn-side-menu">
      <AddBlockButton />
      <Components.Generic.Menu.Root
        onOpenChange={(open) => {
          if (open) {
            sideMenu.freezeMenu();
          } else {
            sideMenu.unfreezeMenu();
          }
        }}
        position="left"
      >
        <div
          className="preshot-block-drag-trigger"
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
          }}
          onPointerDown={startPointerDrag}
        >
          <Components.Generic.Menu.Trigger>
            <Components.SideMenu.Button
              className="bn-button"
              icon={<GripVertical aria-hidden size={19} />}
              label="打开菜单"
            />
          </Components.Generic.Menu.Trigger>
        </div>
        <BlockOperationsMenu controller={controller} notify={notify} />
      </Components.Generic.Menu.Root>
    </Components.SideMenu.Root>
  );
}
