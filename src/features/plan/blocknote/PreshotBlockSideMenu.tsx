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
import type { PreshotEditorBlock } from "./blockOperations";
import { startBlockPointerDrag } from "./blockPointerDrag";
import type { BlockGroupCloner } from "./blockOperations";
import type {
  PreshotBlockSchema,
  PreshotInlineContentSchema,
  PreshotStyleSchema,
} from "./preshotBlockNoteSchema";

interface PreshotBlockSideMenuProps {
  controller: BlockGroupCloner;
  notify(message: string): void;
}

export function PreshotBlockSideMenu({
  controller,
  notify,
}: PreshotBlockSideMenuProps) {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor<
    PreshotBlockSchema,
    PreshotInlineContentSchema,
    PreshotStyleSchema
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
    startBlockPointerDrag({
      editor,
      source: block,
      clientX: event.clientX,
      clientY: event.clientY,
      notify,
      onActivate: () => {
        suppressClickRef.current = true;
        sideMenu.freezeMenu();
      },
      onFinish: (dragged) => {
        if (dragged) sideMenu.unfreezeMenu();
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      },
    });
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
