import "@blocknote/core/fonts/inter.css";
import type { PartialBlock } from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { insertColumnList } from "@blocknote/xl-multi-column";
import "@blocknote/mantine/style.css";
import {
  getDefaultReactSlashMenuItems,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { Columns2, Columns3, Images } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
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
  deleteBlockOrSelection,
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
  persistMediaUrl(url: string): string;
  resolveMediaUrl(url: string): string;
  uploadFile(file: File): Promise<string>;
}

type EditorPartialBlock = PartialBlock<
  typeof preshotBlockNoteSchema.blockSchema,
  typeof preshotBlockNoteSchema.inlineContentSchema,
  typeof preshotBlockNoteSchema.styleSchema
>;

function invalidNestedImageGroup(
  blocks: readonly PreshotEditorBlock[],
  topLevelAncestor?: PreshotEditorBlock,
  parent?: PreshotEditorBlock,
): { block: PreshotEditorBlock; topLevel: PreshotEditorBlock } | undefined {
  for (const block of blocks) {
    const topLevel = topLevelAncestor ?? block;
    if (
      block.type === "imageGroup" &&
      parent !== undefined &&
      parent.type !== "column"
    ) {
      return { block, topLevel };
    }
    const nested = invalidNestedImageGroup(
      block.children,
      topLevel,
      block,
    );
    if (nested) return nested;
  }
  return undefined;
}

function cloneBlocks(
  document: PreshotBlockDocument,
  resolveMediaUrl: (url: string) => string,
): EditorPartialBlock[] {
  const normalize = (block: PreshotBlockDocument["blocks"][number]): unknown => {
    const content = block.content;
    const normalizedContent =
      block.type !== "table" ||
      content === undefined ||
      Array.isArray(content) ||
      content.type !== "tableContent"
        ? content
        : {
            ...content,
            columnWidths: content.columnWidths.map((width: number | null) =>
              width === null ? undefined : width),
          };
    return {
      ...block,
      props:
        (
          block.type === "image" ||
          block.type === "video" ||
          block.type === "audio"
        ) && typeof block.props.url === "string"
          ? {
              ...block.props,
              url: resolveMediaUrl(block.props.url),
            }
          : block.props,
      content: normalizedContent,
      children: block.children.map(normalize),
    };
  };
  const normalized: unknown = structuredClone(document.blocks).map(normalize);
  return normalized as EditorPartialBlock[];
}

function serializeEditorDocument(
  blocks: unknown,
  persistMediaUrl: (url: string) => string,
): PreshotBlockDocument {
  const jsonSafeBlocks = JSON.parse(JSON.stringify(blocks)) as Array<{
    type: string;
    props: Record<string, unknown>;
    children: unknown[];
  }>;
  const normalize = (block: {
    type: string;
    props: Record<string, unknown>;
    children: unknown[];
  }) => {
    if (
      (
        block.type === "image" ||
        block.type === "video" ||
        block.type === "audio"
      ) &&
      typeof block.props.url === "string"
    ) {
      block.props.url = persistMediaUrl(block.props.url);
    }
    block.children.forEach((child) =>
      normalize(child as typeof block));
  };
  jsonSafeBlocks.forEach(normalize);
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
  persistMediaUrl,
  resolveMediaUrl,
  uploadFile,
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
    initialContent: cloneBlocks(document, resolveMediaUrl),
    uploadFile,
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
      const nestedImageGroup = invalidNestedImageGroup(editor.document);
      if (nestedImageGroup) {
        reconcilingRef.current = true;
        editor.transact(() => {
          editor.removeBlocks([nestedImageGroup.block]);
          editor.insertBlocks(
            [nestedImageGroup.block],
            nestedImageGroup.topLevel,
            "after",
          );
        });
        reconcilingRef.current = false;
        return;
      }
      const seen = new Set<string>();
      let duplicate:
        | { block: PreshotEditorBlock; groupId: string }
        | undefined;
      editor.forEachBlock((entry) => {
        const block = entry as PreshotEditorBlock;
        if (block.type !== "imageGroup") return true;
        const groupId = block.props.groupId;
        if (!seen.has(groupId)) {
          seen.add(groupId);
          return true;
        }
        duplicate = { block, groupId };
        return false;
      });
      if (duplicate) {
        const clonedGroupId = imageGroupController.cloneGroup(
          duplicate.groupId,
        );
        if (clonedGroupId) {
          reconcilingRef.current = true;
          editor.updateBlock(duplicate.block, {
            type: "imageGroup",
            props: { groupId: clonedGroupId },
          });
          reconcilingRef.current = false;
          return;
        }
      }
    }
    const next = serializeEditorDocument(
      editor.document,
      persistMediaUrl,
    );
    const serialized = JSON.stringify(next);
    if (serialized === lastEmitRef.current) return;
    lastEmitRef.current = serialized;
    onChangeRef.current(next);
  }, [editor, imageGroupController, persistMediaUrl]);

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

  const contextualImageGroupController = useMemo<
    ImageGroupBlockController
  >(() => ({
    ...imageGroupController,
    removeBlock(blockId) {
      const block = editor.getBlock(blockId);
      if (!block || block.type !== "imageGroup") return;
      deleteBlockOrSelection(editor, block as PreshotEditorBlock);
      notifyBlockOperation("已删除 block");
    },
  }), [editor, imageGroupController, notifyBlockOperation]);

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
      <ImageGroupBlockContext.Provider value={contextualImageGroupController}>
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
                  title: "两列",
                  subtext: "插入可调整宽度的双列布局",
                  aliases: ["两栏", "双列", "columns", "2 columns"],
                  group: "基础块",
                  icon: <Columns2 size={18} />,
                  onItemClick: () => insertColumnList(editor, 2),
                },
                {
                  title: "三列",
                  subtext: "插入可调整宽度的三列布局",
                  aliases: ["三栏", "columns", "3 columns"],
                  group: "基础块",
                  icon: <Columns3 size={18} />,
                  onItemClick: () => insertColumnList(editor, 3),
                },
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
                editor.focus();
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
