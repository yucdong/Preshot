import "@blocknote/core/fonts/inter.css";
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
import {
  Columns2,
  Columns3,
  ContactRound,
  Images,
  MapPin,
  PackageOpen,
  Shirt,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTheme } from "../../../app/theme/ThemeContext";
import {
  BLOCK_DOCUMENT_SCHEMA_VERSION,
  type PreshotBlockDocument,
  validateBlockDocument,
} from "../../../domain/plan/canvas/blockDocument";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteEditor,
  type PreshotEditorPartialBlock,
} from "./preshotBlockNoteSchema";
import { resolveBlockNoteDocumentAssets } from "./blockNoteDocumentAssets";
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
import type {
  AgentWorkspacePublisher,
} from "../../../domain/agent/workspaceBridge";
import {
  ArtifactBlockContext,
  type ArtifactBlockController,
} from "./ArtifactBlockContext";
import type { ArtifactKind } from "../../../domain/plan/canvas/blockDocument";

interface BlockNoteDocumentEditorProps {
  agentWorkspace?: AgentWorkspacePublisher;
  ariaLabel: string;
  document: PreshotBlockDocument;
  artifactController: ArtifactBlockController;
  imageGroupController: ImageGroupBlockController;
  onChange(document: PreshotBlockDocument): void;
  onEditorReady?(editor: PreshotBlockNoteEditor): void;
  onDocumentTransactionReady?(
    applyDocument: (document: PreshotBlockDocument) => void,
  ): () => void;
  persistMediaUrl(url: string): string;
  resolveMediaUrl(url: string): string;
  uploadFile(file: File): Promise<string>;
}

type PreshotSidecarBlock = Extract<
  PreshotEditorBlock,
  {
    type:
      | "imageGroup"
      | "shootingLocation"
      | "modelCard"
      | "clothing"
      | "prop";
  }
>;

function isSidecarBlock(
  block: PreshotEditorBlock,
): block is PreshotSidecarBlock {
  return block.type === "imageGroup" ||
    block.type === "shootingLocation" ||
    block.type === "modelCard" ||
    block.type === "clothing" ||
    block.type === "prop";
}

function invalidNestedSidecarBlock(
  blocks: readonly PreshotEditorBlock[],
  topLevelAncestor?: PreshotEditorBlock,
  parent?: PreshotEditorBlock,
): { block: PreshotEditorBlock; topLevel: PreshotEditorBlock } | undefined {
  for (const block of blocks) {
    const topLevel = topLevelAncestor ?? block;
    if (
      isSidecarBlock(block) &&
      parent !== undefined &&
      parent.type !== "column"
    ) {
      return { block, topLevel };
    }
    const nested = invalidNestedSidecarBlock(
      block.children,
      topLevel,
      block,
    );
    if (nested) return nested;
  }
  return undefined;
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
        block.type === "audio" ||
        block.type === "file"
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
  agentWorkspace,
  ariaLabel,
  artifactController,
  document,
  imageGroupController,
  onChange,
  onEditorReady,
  onDocumentTransactionReady,
  persistMediaUrl,
  resolveMediaUrl,
  uploadFile,
}: BlockNoteDocumentEditorProps) {
  const { resolved } = useTheme();
  const onChangeRef = useRef(onChange);
  const lastEmitRef = useRef(JSON.stringify(document));
  const reconcilingRef = useRef(false);
  const proposalTransactionRef = useRef(false);
  const proposalTransactionTimerRef = useRef<number | null>(null);
  const operationToastTimerRef = useRef<number | null>(null);
  const [operationToast, setOperationToast] = useState<string | null>(null);
  const editor = useCreateBlockNote({
    schema: preshotBlockNoteSchema,
    dictionary: zh,
    initialContent: resolveBlockNoteDocumentAssets(document, resolveMediaUrl),
    uploadFile,
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!agentWorkspace) return;
    const publishSelection = () => {
      const selection = editor.getSelection();
      const cursorBlockId = editor.getTextCursorPosition().block.id;
      agentWorkspace.publishSelection({
        selectedBlockIds: selection?.blocks.map((block) => block.id) ?? [],
        cursorBlockId,
      });
    };
    publishSelection();
    return editor.onSelectionChange(publishSelection);
  }, [agentWorkspace, editor]);

  useEffect(() => {
    if (!agentWorkspace) return;
    return agentWorkspace.registerBlockNavigator({
      focusBlock(blockId) {
        const block = editor.getBlock(blockId);
        if (!block) return false;
        editor.setTextCursorPosition(block, "start");
        editor.focus();
        const escapedId = typeof CSS !== "undefined" && CSS.escape
          ? CSS.escape(blockId)
          : blockId.replaceAll('"', '\\"');
        const target = editor.domElement?.querySelector<HTMLElement>(
          `[data-id="${escapedId}"]`,
        );
        target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        target?.setAttribute("data-agent-citation-highlight", "true");
        if (target) {
          window.setTimeout(() => {
            target.removeAttribute("data-agent-citation-highlight");
          }, 2_000);
        }
        return true;
      },
    });
  }, [agentWorkspace, editor]);

  useEffect(() => () => {
    if (operationToastTimerRef.current !== null) {
      window.clearTimeout(operationToastTimerRef.current);
    }
    if (proposalTransactionTimerRef.current !== null) {
      window.clearTimeout(proposalTransactionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!onDocumentTransactionReady) return;
    const applyDocument = (next: PreshotBlockDocument) => {
      const serialized = JSON.stringify(next);
      lastEmitRef.current = serialized;
      proposalTransactionRef.current = true;
      if (proposalTransactionTimerRef.current !== null) {
        window.clearTimeout(proposalTransactionTimerRef.current);
      }
      const replacement = resolveBlockNoteDocumentAssets(
        next,
        resolveMediaUrl,
      );
      editor.transact(() => {
        editor.replaceBlocks(editor.document, replacement);
      });
      proposalTransactionTimerRef.current = window.setTimeout(() => {
        proposalTransactionTimerRef.current = null;
        proposalTransactionRef.current = false;
      }, 0);
    };
    return onDocumentTransactionReady(applyDocument);
  }, [editor, onDocumentTransactionReady, resolveMediaUrl]);

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
    if (proposalTransactionRef.current) return;
    if (!reconcilingRef.current) {
      const nestedSidecarBlock = invalidNestedSidecarBlock(editor.document);
      if (nestedSidecarBlock) {
        reconcilingRef.current = true;
        editor.transact(() => {
          editor.removeBlocks([nestedSidecarBlock.block]);
          editor.insertBlocks(
            [nestedSidecarBlock.block],
            nestedSidecarBlock.topLevel,
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
      const seenArtifacts = new Set<string>();
      let duplicateArtifact:
        | { block: PreshotSidecarBlock; artifactId: string }
        | undefined;
      editor.forEachBlock((entry) => {
        const block = entry as PreshotEditorBlock;
        if (!isSidecarBlock(block) || block.type === "imageGroup") return true;
        const artifactId = block.props.artifactId;
        if (!seenArtifacts.has(artifactId)) {
          seenArtifacts.add(artifactId);
          return true;
        }
        duplicateArtifact = { block, artifactId };
        return false;
      });
      if (duplicateArtifact) {
        const artifactId = artifactController.cloneArtifact(
          duplicateArtifact.artifactId,
        );
        if (artifactId) {
          reconcilingRef.current = true;
          editor.updateBlock(duplicateArtifact.block, {
            type: duplicateArtifact.block.type,
            props: { artifactId },
          } as PreshotEditorPartialBlock);
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
  }, [artifactController, editor, imageGroupController, persistMediaUrl]);

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

  const contextualArtifactController = useMemo<ArtifactBlockController>(
    () => ({
      ...artifactController,
      duplicateArtifactBlock(blockId) {
        const block = editor.getBlock(blockId) as
          | PreshotEditorBlock
          | undefined;
        if (!block || !isSidecarBlock(block) || block.type === "imageGroup") {
          return;
        }
        const artifactId = artifactController.cloneArtifact(
          block.props.artifactId,
        );
        if (!artifactId) return;
        editor.insertBlocks(
          [{
            type: block.type,
            props: { artifactId },
          } as PreshotEditorPartialBlock],
          block,
          "after",
        );
        notifyBlockOperation("已复制素材组件");
      },
      removeArtifactBlock(blockId) {
        const block = editor.getBlock(blockId) as
          | PreshotEditorBlock
          | undefined;
        if (!block || !isSidecarBlock(block) || block.type === "imageGroup") {
          return;
        }
        deleteBlockOrSelection(editor, block);
        notifyBlockOperation("已删除素材组件");
      },
    }),
    [artifactController, editor, notifyBlockOperation],
  );

  const sidecarCloner = useMemo(() => ({
    cloneGroup: imageGroupController.cloneGroup,
    cloneArtifact: artifactController.cloneArtifact,
  }), [artifactController.cloneArtifact, imageGroupController.cloneGroup]);

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
        sidecarCloner,
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
  }, [editor, notifyBlockOperation, sidecarCloner]);

  return (
    <div
      aria-label={ariaLabel}
      className="preshot-blocknote-document"
      data-editor-engine="blocknote"
      onKeyDownCapture={handleBlockShortcut}
      role="group"
    >
      <ImageGroupBlockContext.Provider value={contextualImageGroupController}>
        <ArtifactBlockContext.Provider value={contextualArtifactController}>
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
              const insertArtifact = (
                kind: ArtifactKind,
              ) => {
                const artifactId = artifactController.createArtifact(kind);
                try {
                  insertOrUpdateBlockForSlashMenu(editor, {
                    type: kind,
                    props: { artifactId },
                  } as PreshotEditorPartialBlock);
                  window.requestAnimationFrame(() => {
                    const escaped = typeof CSS !== "undefined" && CSS.escape
                      ? CSS.escape(artifactId)
                      : artifactId.replaceAll('"', '\\"');
                    const input = editor.domElement?.querySelector<
                      HTMLInputElement
                    >(`[data-artifact-id="${escaped}"] input`);
                    input?.focus();
                    input?.select();
                  });
                } catch (error) {
                  artifactController.discardPendingArtifact?.(artifactId);
                  throw error;
                }
              };
              const items = [
                {
                  title: "图片组",
                  subtext: "插入可拖拽、可缩放的参考图片组",
                  aliases: ["图片", "参考图", "image", "gallery"],
                  group: "素材组件",
                  icon: <Images size={18} />,
                  onItemClick: () => {
                    const groupId = imageGroupController.createGroup();
                    insertOrUpdateBlockForSlashMenu(editor, {
                      type: "imageGroup",
                      props: { groupId },
                    });
                  },
                },
                {
                  title: "拍摄场地",
                  subtext: "整理场地信息和参考图片",
                  aliases: ["场地", "地址", "venue", "location"],
                  group: "素材组件",
                  icon: <MapPin size={18} />,
                  onItemClick: () => insertArtifact("shootingLocation"),
                },
                {
                  title: "模特信息",
                  subtext: "记录模特资料和样片",
                  aliases: ["模特", "model", "talent"],
                  group: "素材组件",
                  icon: <ContactRound size={18} />,
                  onItemClick: () => insertArtifact("modelCard"),
                },
                {
                  title: "服装",
                  subtext: "整理服装主图、试穿和来源",
                  aliases: ["衣服", "造型", "garment", "clothing"],
                  group: "素材组件",
                  icon: <Shirt size={18} />,
                  onItemClick: () => insertArtifact("clothing"),
                },
                {
                  title: "道具",
                  subtext: "整理道具图片和来源",
                  aliases: ["物件", "props", "prop"],
                  group: "素材组件",
                  icon: <PackageOpen size={18} />,
                  onItemClick: () => insertArtifact("prop"),
                },
                {
                  title: "两列",
                  subtext: "插入可调整宽度的双列布局",
                  aliases: ["两栏", "双列", "columns", "2 columns"],
                  group: "布局",
                  icon: <Columns2 size={18} />,
                  onItemClick: () => insertColumnList(editor, 2),
                },
                {
                  title: "三列",
                  subtext: "插入可调整宽度的三列布局",
                  aliases: ["三栏", "columns", "3 columns"],
                  group: "布局",
                  icon: <Columns3 size={18} />,
                  onItemClick: () => insertColumnList(editor, 3),
                },
                ...defaults,
              ];
              return filterSuggestionItems(items, query);
            }}
            triggerCharacter="/"
          />
          <SideMenuController
            sideMenu={() => (
              <PreshotBlockSideMenu
                controller={sidecarCloner}
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
        </ArtifactBlockContext.Provider>
      </ImageGroupBlockContext.Provider>
    </div>
  );
}
