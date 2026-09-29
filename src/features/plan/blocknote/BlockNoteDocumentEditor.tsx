import { ui, useUiLanguage } from "../../../shared/i18n/ui";
import "@blocknote/core/fonts/inter.css";
import { createLiveEditorDictionary, editorPlaceholderStyles } from "./editorLanguage";
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  getDefaultReactSlashMenuItems,
  FilePanelController,
  FormattingToolbarController,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import {
  ContactRound,
  Images,
  Library,
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
import type { PreshotBlockDocument } from "../../../domain/plan/canvas/blockDocument";
import { documentInsertionAnchor } from "../../../domain/plan/canvas/columnTree";
import {
  preshotBlockNoteSchema,
  type PreshotBlockNoteEditor,
  type PreshotEditorPartialBlock,
} from "./preshotBlockNoteSchema";
import { resolveBlockNoteDocumentAssets, serializeBlockNoteDocumentAssets } from "./blockNoteDocumentAssets";
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
import {
  ArtifactBlockContext,
  type ArtifactBlockController,
} from "./ArtifactBlockContext";
import type { ArtifactKind } from "../../../domain/plan/canvas/blockDocument";
import { closeHistory } from "prosemirror-history";
import type { MaterialEditorBridge } from "./MaterialEditorBridge";
import { IMAGE_CLIPBOARD_SELECTION_CHANGE, registerImageClipboardDocument } from "./clipboard/imageClipboardDom";
import { selectedClipboardComponent } from "./clipboard/selectedClipboardComponent";
import { attachExternalImageHistory } from "./clipboard/externalImageHistory";
import { focusClipboardTargetWhenReady } from "./clipboard/focusClipboardTargetWhenReady";
import { PreshotImageFilePanel } from "./PreshotImageFilePanel";
import { PreshotFormattingToolbar } from "./PreshotFormattingToolbar";
import { useColumnResize } from "./useColumnResize";
import { attachColumnStructureGuard } from "./columnOperations";
import { CaptureBlockImageContext, type CaptureBlockImage } from "./ImageBlockCaptureContext";

interface BlockNoteDocumentEditorProps {
  ariaLabel: string;
  document: PreshotBlockDocument;
  artifactController: ArtifactBlockController;
  imageGroupController: ImageGroupBlockController;
  onChange(document: PreshotBlockDocument): void;
  onEditorReady?(editor: PreshotBlockNoteEditor): void;
  onMaterialEditorReady?(bridge: MaterialEditorBridge): () => void;
  onInsertMaterial?(): void;
  persistMediaUrl(url: string, blockId?: string): string;
  resolveMediaUrl(url: string): string;
  uploadFile(file: File): Promise<string>;
  captureImage?: CaptureBlockImage;
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
    if (isSidecarBlock(block) && parent !== undefined && parent.type !== "column") {
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

export function BlockNoteDocumentEditor({
  ariaLabel,
  artifactController,
  document,
  imageGroupController,
  onChange,
  onEditorReady,
  onMaterialEditorReady,
  onInsertMaterial,
  persistMediaUrl,
  resolveMediaUrl,
  uploadFile,
  captureImage,
}: BlockNoteDocumentEditorProps) {
  const language = useUiLanguage();
  const { resolved } = useTheme();
  const documentRootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const lastEmitRef = useRef(JSON.stringify(document));
  const lastActiveBlockRef = useRef<string | null>(null);
  const externalHistoryRef = useRef<ReturnType<typeof attachExternalImageHistory> | null>(null);
  const pendingClipboardFocusRef = useRef<(() => void) | null>(null);
  const reconcilingRef = useRef(false);
  const documentTransactionRef = useRef(false);
  const documentTransactionTimerRef = useRef<number | null>(null);
  const operationToastTimerRef = useRef<number | null>(null);
  const [operationToast, setOperationToast] = useState<string | null>(null);
  const editor = useCreateBlockNote({
    disableExtensions: ["columnResize"],
    schema: preshotBlockNoteSchema,
    dictionary: createLiveEditorDictionary(),
    initialContent: resolveBlockNoteDocumentAssets(document, resolveMediaUrl),
    uploadFile,
    resolveFileUrl: async (url) => resolveMediaUrl(url),
  });
  useColumnResize(editor, imageGroupController.structureEditable !== false);
  useEffect(() => attachColumnStructureGuard(editor), [editor]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => editor.onSelectionChange(() => {
    if (!editor.prosemirrorView.hasFocus()) return;
    lastActiveBlockRef.current = editor.getSelection()?.blocks[0]?.id ??
      editor.getTextCursorPosition().block.id;
  }), [editor]);

  useEffect(() => {
    const root = documentRootRef.current;
    if (!root) return;
    const topLevelId = (id: string): string => {
      return documentInsertionAnchor(editor.document, id) ?? id;
    };
    const unregister = registerImageClipboardDocument(root, {
      getSelectedComponent: () => selectedClipboardComponent(editor, root),
      getTopLevelBlock: topLevelId,
      getAnchor() {
        const id = lastActiveBlockRef.current;
        return id ? topLevelId(id) : null;
      },
      getNativeSelection() {
        const view = editor.prosemirrorView;
        if (!view.hasFocus()) return null;
        const selection = view.state.selection;
        if (selection.toJSON().type !== "node") return null;
        const node = view.state.doc.nodeAt(selection.from);
        if (node?.type.name === "blockContainer" && node.childCount === 1 &&
          node.firstChild?.type.name === "image" &&
          editor.getBlock(node.attrs.id)?.type === "image") return node.attrs.id as string;
        if (node?.type.name !== "image") return null;
        for (let depth = selection.$from.depth; depth > 0; depth--) {
          const ancestor = selection.$from.node(depth);
          if (ancestor.type.name === "blockContainer" && typeof ancestor.attrs.id === "string" &&
            editor.getBlock(ancestor.attrs.id)?.type === "image") return ancestor.attrs.id as string;
        }
        return null;
      },
      resolveNativeImage(element) {
        // BlockNote 0.53's native image renderer, not a thumbnail in a sidecar block.
        if (!element.matches("img.bn-visual-media") ||
          !element.closest("[data-content-type='image']")) return null;
        const id = element.closest<HTMLElement>("[data-id]")?.dataset.id;
        return id && editor.getBlock(id)?.type === "image" ? id : null;
      },
    });
    const unsubscribe = editor.onSelectionChange(() => {
      root.dispatchEvent(new Event(IMAGE_CLIPBOARD_SELECTION_CHANGE, { bubbles: true }));
    });
    return () => { unsubscribe(); unregister(); };
  }, [editor]);

  useEffect(() => () => {
    pendingClipboardFocusRef.current?.();
    if (operationToastTimerRef.current !== null) {
      window.clearTimeout(operationToastTimerRef.current);
    }
    if (documentTransactionTimerRef.current !== null) {
      window.clearTimeout(documentTransactionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const history = attachExternalImageHistory(editor);
    externalHistoryRef.current = history;
    return () => {
      externalHistoryRef.current = null;
      history.dispose();
    };
  }, [editor]);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!onMaterialEditorReady) return;
    const applyDocument = (next: PreshotBlockDocument, isolatedHistory = false) => {
      const serialized = JSON.stringify(next);
      lastEmitRef.current = serialized;
      documentTransactionRef.current = true;
      if (documentTransactionTimerRef.current !== null) {
        window.clearTimeout(documentTransactionTimerRef.current);
      }
      const replacement = resolveBlockNoteDocumentAssets(
        next,
        resolveMediaUrl,
      );
      try {
        if (isolatedHistory) editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
        editor.transact(() => {
          editor.replaceBlocks(editor.document, replacement);
        });
        if (isolatedHistory) editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
      } finally {
        documentTransactionTimerRef.current = window.setTimeout(() => {
          documentTransactionTimerRef.current = null;
          documentTransactionRef.current = false;
        }, 0);
      }
    };
    const unregisterMaterial = onMaterialEditorReady?.({
      getAnchor: () => {
        const anchor = lastActiveBlockRef.current;
        return anchor && editor.getBlock(anchor) ? anchor : null;
      },
      applyDocument: (next) => applyDocument(next, true),
      recordExternalHistory(entry) {
        const history = externalHistoryRef.current;
        if (!history) throw new Error(ui("当前图片粘贴历史已结束。"));
        history.recordExternalHistory(entry);
      },
      undo() {
        if (!externalHistoryRef.current) throw new Error(ui("当前图片粘贴历史已结束。"));
        if (!editor.undo()) throw new Error(ui("当前没有可撤销的编辑，请重新确认图片操作。"));
      },
      focusBlock(blockId) {
        pendingClipboardFocusRef.current?.();
        const root = documentRootRef.current;
        if (!root) return;
        pendingClipboardFocusRef.current = focusClipboardTargetWhenReady(root, () => {
          if (editor.prosemirrorView.isDestroyed) return;
          const block = editor.getBlock(blockId);
          if (!block) return;
          editor.setTextCursorPosition(block, "start");
          editor.focus();
          const target = editor.domElement?.querySelector<HTMLElement>(
            `[data-id="${CSS.escape(blockId)}"]`,
          );
          target?.scrollIntoView?.({ block: "center" });
          target?.querySelector<HTMLInputElement>("input")?.focus();
        });
      },
    });
    return () => {
      unregisterMaterial?.();
    };
  }, [editor, onMaterialEditorReady, resolveMediaUrl]);

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
    if (documentTransactionRef.current) return;
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
    const next = serializeBlockNoteDocumentAssets(
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
      notifyBlockOperation(ui("已删除 block"));
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
        notifyBlockOperation(ui("已复制素材组件"));
      },
      removeArtifactBlock(blockId) {
        const block = editor.getBlock(blockId) as
          | PreshotEditorBlock
          | undefined;
        if (!block || !isSidecarBlock(block) || block.type === "imageGroup") {
          return;
        }
        deleteBlockOrSelection(editor, block);
        notifyBlockOperation(ui("已删除素材组件"));
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
      if (inserted.length > 0) notifyBlockOperation(ui("已复制 block"));
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      if (moveSpecificBlock(editor, block, "up")) {
        notifyBlockOperation(ui("Block 已上移"));
      }
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      if (moveSpecificBlock(editor, block, "down")) {
        notifyBlockOperation(ui("Block 已下移"));
      }
    }
  }, [editor, notifyBlockOperation, sidecarCloner]);

  return (
    <div
      aria-label={ariaLabel}
      className="preshot-blocknote-document"
      data-editor-engine="blocknote"
      data-clipboard-document=""
      ref={documentRootRef}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.target)) return;
        const block = event.target.closest<HTMLElement>("[data-id]");
        lastActiveBlockRef.current = block?.dataset.id ?? editor.getTextCursorPosition().block.id;
      }}
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof Element)) return;
        const block = event.target.closest<HTMLElement>("[data-id]");
        if (block?.dataset.id) lastActiveBlockRef.current = block.dataset.id;
      }}
      onKeyDownCapture={handleBlockShortcut}
      role="group"
      data-preshot-editor-language={language}
    >
      <style>{editorPlaceholderStyles(language)}</style>
      <ImageGroupBlockContext.Provider value={contextualImageGroupController}>
        <ArtifactBlockContext.Provider value={contextualArtifactController}>
        <CaptureBlockImageContext.Provider value={captureImage}>
        <BlockNoteView
          autoFocus={false}
          editor={editor}
          onChange={handleChange}
          slashMenu={false}
          sideMenu={false}
          filePanel={false}
          formattingToolbar={false}
          theme={resolved}
        >
          <FilePanelController filePanel={PreshotImageFilePanel} />
          <FormattingToolbarController formattingToolbar={PreshotFormattingToolbar} />
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
                  title: ui("图片组"),
                  subtext: ui("插入可拖拽、可缩放的参考图片组"),
                  aliases: ["图片", "参考图", "image", "gallery"],
                  group: ui("素材组件"),
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
                  title: ui("拍摄场地"),
                  subtext: ui("整理场地信息和参考图片"),
                  aliases: ["场地", "地址", "venue", "location"],
                  group: ui("素材组件"),
                  icon: <MapPin size={18} />,
                  onItemClick: () => insertArtifact("shootingLocation"),
                },
                {
                  title: ui("模特信息"),
                  subtext: ui("记录模特资料和样片"),
                  aliases: ["模特", "model", "talent"],
                  group: ui("素材组件"),
                  icon: <ContactRound size={18} />,
                  onItemClick: () => insertArtifact("modelCard"),
                },
                {
                  title: ui("服装"),
                  subtext: ui("整理服装信息和参考图片"),
                  aliases: ["衣服", "造型", "garment", "clothing"],
                  group: ui("素材组件"),
                  icon: <Shirt size={18} />,
                  onItemClick: () => insertArtifact("clothing"),
                },
                {
                  title: ui("道具"),
                  subtext: ui("整理道具图片和来源"),
                  aliases: ["物件", "props", "prop"],
                  group: ui("素材组件"),
                  icon: <PackageOpen size={18} />,
                  onItemClick: () => insertArtifact("prop"),
                },
                ...(onInsertMaterial ? [{
                  title: ui("从素材库插入"),
                  subtext: ui("预览并插入已保存组件的独立副本"),
                  aliases: ["素材库", "library", "saved"],
                  group: ui("素材组件"),
                  icon: <Library size={18} />,
                  onItemClick: onInsertMaterial,
                }] : []),
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
        </CaptureBlockImageContext.Provider>
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
              {ui("撤销")}
            </button>
          </div>
        ) : null}
        </ArtifactBlockContext.Provider>
      </ImageGroupBlockContext.Provider>
    </div>
  );
}
