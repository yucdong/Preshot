import "@blocknote/core/fonts/inter.css";
import type { PartialBlock } from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  getDefaultReactSlashMenuItems,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { Images } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTheme } from "../../../app/theme/ThemeProvider";
import {
  BLOCK_DOCUMENT_SCHEMA_VERSION,
  type PreshotBlockDocument,
  validateBlockDocument,
} from "../../../domain/plan/canvas/blockDocument";
import { preshotBlockNoteSchema } from "./blockNoteSchema";
import {
  ImageGroupBlockContext,
  type ImageGroupBlockController,
} from "./ImageGroupBlockContext";
import {
  duplicateBlockTree,
  moveSpecificBlock,
  type PreshotEditorBlock,
} from "./blockOperations";
import { PreshotBlockSideMenu } from "./PreshotBlockSideMenu";

interface BlockNoteDocumentEditorProps {
  ariaLabel: string;
  document: PreshotBlockDocument;
  imageGroupController: ImageGroupBlockController;
  onChange(document: PreshotBlockDocument): void;
  onEditorReady?(editor: typeof preshotBlockNoteSchema.BlockNoteEditor): void;
}

type EditorPartialBlock = PartialBlock<
  typeof preshotBlockNoteSchema.blockSchema,
  typeof preshotBlockNoteSchema.inlineContentSchema,
  typeof preshotBlockNoteSchema.styleSchema
>;

function cloneBlocks(document: PreshotBlockDocument): EditorPartialBlock[] {
  const normalized: unknown = structuredClone(document.blocks).map((block) => {
    const content = block.content;
    if (
      block.type !== "table" ||
      content === undefined ||
      Array.isArray(content) ||
      content.type !== "tableContent"
    ) {
      return block;
    }
    return {
      ...block,
      content: {
        ...content,
        columnWidths: content.columnWidths.map((width: number | null) =>
          width === null ? undefined : width,
        ),
      },
    };
  });
  return normalized as EditorPartialBlock[];
}

function serializeEditorDocument(blocks: unknown): PreshotBlockDocument {
  const jsonSafeBlocks: unknown = JSON.parse(JSON.stringify(blocks));
  return validateBlockDocument({
    format: "preshot-blocks",
    version: BLOCK_DOCUMENT_SCHEMA_VERSION,
    blocks: jsonSafeBlocks,
  });
}

export function BlockNoteDocumentEditor({
  ariaLabel,
  document,
  imageGroupController,
  onChange,
  onEditorReady,
}: BlockNoteDocumentEditorProps) {
  const { resolved } = useTheme();
  const onChangeRef = useRef(onChange);
  const lastEmitRef = useRef(JSON.stringify(document));
  const reconcilingRef = useRef(false);
  const operationToastTimerRef = useRef<number | null>(null);
  const [operationToast, setOperationToast] = useState<string | null>(null);
  const editor = useCreateBlockNote({
    schema: preshotBlockNoteSchema,
    dictionary: zh,
    initialContent: cloneBlocks(document),
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => () => {
    if (operationToastTimerRef.current !== null) {
      window.clearTimeout(operationToastTimerRef.current);
    }
  }, []);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (import.meta.env.VITE_WORKSPACE_ADAPTER !== "memory") return;
    const target = window as typeof window & {
      __PRESHOT_BLOCKNOTE_EDITOR__?: typeof editor;
    };
    target.__PRESHOT_BLOCKNOTE_EDITOR__ = editor;
    return () => {
      delete target.__PRESHOT_BLOCKNOTE_EDITOR__;
    };
  }, [editor]);

  const handleChange = useCallback(() => {
    if (!reconcilingRef.current) {
      const nestedImageGroup = editor.document
        .flatMap((parent) =>
          parent.children.map((child) => ({ child, parent })),
        )
        .find(({ child }) => child.type === "imageGroup");
      if (nestedImageGroup) {
        reconcilingRef.current = true;
        editor.transact(() => {
          editor.removeBlocks([nestedImageGroup.child]);
          editor.insertBlocks(
            [nestedImageGroup.child],
            nestedImageGroup.parent,
            "after",
          );
        });
        reconcilingRef.current = false;
        return;
      }
      const seen = new Set<string>();
      for (const block of editor.document) {
        if (block.type !== "imageGroup") continue;
        const groupId = block.props.groupId;
        if (!seen.has(groupId)) {
          seen.add(groupId);
          continue;
        }
        const clonedGroupId = imageGroupController.cloneGroup(groupId);
        if (!clonedGroupId) continue;
        reconcilingRef.current = true;
        editor.updateBlock(block, {
          type: "imageGroup",
          props: { groupId: clonedGroupId },
        });
        reconcilingRef.current = false;
        return;
      }
    }
    const next = serializeEditorDocument(editor.document);
    const serialized = JSON.stringify(next);
    if (serialized === lastEmitRef.current) return;
    lastEmitRef.current = serialized;
    onChangeRef.current(next);
  }, [editor, imageGroupController]);

  const notifyBlockOperation = useCallback((message: string) => {
    if (operationToastTimerRef.current !== null) {
      window.clearTimeout(operationToastTimerRef.current);
    }
    setOperationToast(message);
    operationToastTimerRef.current = window.setTimeout(() => {
      operationToastTimerRef.current = null;
      setOperationToast(null);
    }, 3_000);
  }, []);

  const handleBlockShortcut = useCallback((
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const selected = editor.getSelection()?.blocks[0];
    const block = (
      selected ?? editor.getTextCursorPosition().block
    ) as PreshotEditorBlock;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "d"
    ) {
      event.preventDefault();
      const inserted = duplicateBlockTree(
        editor,
        block,
        imageGroupController,
      );
      if (inserted.length > 0) notifyBlockOperation("已复制 block");
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      if (moveSpecificBlock(editor, block, "up")) {
        notifyBlockOperation("Block 已上移");
      }
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      if (moveSpecificBlock(editor, block, "down")) {
        notifyBlockOperation("Block 已下移");
      }
    }
  }, [editor, imageGroupController, notifyBlockOperation]);

  return (
    <div
      aria-label={ariaLabel}
      className="preshot-blocknote-document"
      data-editor-engine="blocknote"
      onKeyDownCapture={handleBlockShortcut}
      role="group"
    >
      <ImageGroupBlockContext.Provider value={imageGroupController}>
        <BlockNoteView
          editor={editor}
          onChange={handleChange}
          slashMenu={false}
          sideMenu={false}
          theme={resolved}
        >
          <SuggestionMenuController
            getItems={async (query) => {
              const defaults = getDefaultReactSlashMenuItems(editor);
              const items = [
                ...defaults,
                {
                  title: "图片组",
                  subtext: "插入可拖拽、可缩放的参考图片组",
                  aliases: ["图片", "参考图", "image", "gallery"],
                  group: "基础块",
                  icon: <Images size={18} />,
                  onItemClick: () => {
                    const groupId = imageGroupController.createGroup();
                    insertOrUpdateBlockForSlashMenu(editor, {
                      type: "imageGroup",
                      props: { groupId },
                    });
                  },
                },
              ];
              return filterSuggestionItems(items, query);
            }}
            triggerCharacter="/"
          />
          <SideMenuController
            sideMenu={() => (
              <PreshotBlockSideMenu
                controller={imageGroupController}
                notify={notifyBlockOperation}
              />
            )}
          />
        </BlockNoteView>
        {operationToast ? (
          <div
            className="preshot-block-operation-toast"
            role="status"
          >
            <span>{operationToast}</span>
            <button
              onClick={() => {
                if (editor.undo()) setOperationToast(null);
              }}
              type="button"
            >
              撤销
            </button>
          </div>
        ) : null}
      </ImageGroupBlockContext.Provider>
    </div>
  );
}
