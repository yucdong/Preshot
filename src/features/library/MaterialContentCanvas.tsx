import { ui, useUiLanguage } from "../../shared/i18n/ui";
import "@blocknote/core/fonts/inter.css";
import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { Camera, Maximize, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore, type Ref,
} from "react";
import type { MaterialDetail, MaterialPayload } from "../../domain/library/models";
import type { MaterialContentEditorRepository } from "../../domain/library/ports";
import type { NormalizedImageCrop } from "../../domain/plan/canvas/imageView";
import type { ReferenceImageCropBounds } from "../../domain/plan/ports";
import { ArtifactBlockContext, type ArtifactBlockController } from "../plan/blocknote/ArtifactBlockContext";
import { materialArtifactLabels } from "./libraryUi";
import { MaterialBrowser } from "./MaterialBrowser";
import { useOptionalMaterialLibrary } from "./MaterialLibraryContext";
import { importMaterialImages } from "./importMaterialImages";
import { ArtifactDraftContext, ArtifactDraftValidationError, createArtifactDraftRegistry } from "../plan/blocknote/ArtifactDraftContext";
import {
  BLOCKNOTE_DOCUMENT_HORIZONTAL_PADDING, BLOCKNOTE_DOCUMENT_WIDTH,
  BLOCKNOTE_MAX_ZOOM, BLOCKNOTE_MIN_ZOOM, BLOCKNOTE_ZOOM_STEP, fitBlockNoteDocumentZoom,
} from "../plan/blocknote/canvasViewport";
import { ImageDragPreviewProvider } from "../plan/blocknote/ImageDragPreviewContext";
import { ImageGroupBlockContext, type ImageGroupBlockController } from "../plan/blocknote/ImageGroupBlockContext";
import { preshotBlockNoteSchema, type PreshotEditorPartialBlock } from "../plan/blocknote/preshotBlockNoteSchema";
import { ReferenceImageLightbox } from "../plan/ReferenceImageLightbox";
import { MaterialContentDraft } from "./MaterialContentDraft";
import { lockMaterialContentEditor } from "./materialStructureLock";
import type { ImageClipboardContents, ImageClipboardSelection, ImagePasteTarget } from "../../domain/clipboard/imageClipboard";
import { unavailableImageClipboard } from "../../domain/clipboard/imageClipboard";
import { useImageClipboardPort } from "../plan/ImageClipboardContext";
import { ImageClipboardScope } from "../plan/blocknote/clipboard/ImageClipboardScope";
import { clipboardPasteAsset } from "../plan/blocknote/imagePasteAssets";
import { IMAGE_CLIPBOARD_SELECTION_CHANGE, registerImageClipboardDocument } from "../plan/blocknote/clipboard/imageClipboardDom";
import { selectedClipboardComponent } from "../plan/blocknote/clipboard/selectedClipboardComponent";

export interface MaterialContentCanvasHandle {
  readPayload(): MaterialPayload;
  readViewport(): MaterialCanvasViewport;
}

export interface MaterialCanvasViewport {
  zoom: number;
  autoFit: boolean;
  scrollTop: number;
  scrollLeft: number;
}

export interface MaterialContentCanvasProps {
  material: MaterialDetail;
  assets: ReadonlyMap<string, string>;
  sessionId: string;
  repository: MaterialContentEditorRepository;
  disabled?: boolean;
  initialViewport?: MaterialCanvasViewport;
  onChange(payload: MaterialPayload): void;
  onBusyChange(busy: boolean): void;
  onError(message: string): void;
  ref?: Ref<MaterialContentCanvasHandle>;
}

function cropPixels(
  crop: NormalizedImageCrop, width: number, height: number,
): ReferenceImageCropBounds {
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
    crop.x + crop.width > 1 || crop.y + crop.height > 1 ||
    !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
  ) throw new Error(ui("裁剪范围或原图尺寸无效，请重新打开图片。"));
  const x = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
  return {
    x, y,
    width: Math.min(width, Math.max(x + 1, Math.round((crop.x + crop.width) * width))) - x,
    height: Math.min(height, Math.max(y + 1, Math.round((crop.y + crop.height) * height))) - y,
  };
}

function rejectStructure(): never {
  throw new Error(ui("素材编辑不支持添加、删除、复制或替换组件。"));
}

export function MaterialContentCanvas(props: MaterialContentCanvasProps) {
  useUiLanguage();
  return <MaterialContentCanvasSession
    key={`${props.sessionId}:${props.material.id}:${props.material.revision}`} {...props} />;
}

function MaterialContentCanvasSession(props: MaterialContentCanvasProps) {
  useUiLanguage();
  const { disabled = false, material, assets, sessionId, repository, ref } = props;
  const imageClipboard = useImageClipboardPort();
  const callbacks = useRef(props);
  useLayoutEffect(() => { callbacks.current = props; }, [props]);
  const [store] = useState(() => new MaterialContentDraft(material, assets, props.onChange));
  const library = useOptionalMaterialLibrary();
  const [libraryTarget, setLibraryTarget] = useState<string | null>(null);
  useLayoutEffect(() => store.setOnChange(props.onChange), [store, props.onChange]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [drafts] = useState(createArtifactDraftRegistry);
  const [busy, setBusy] = useState(false);
  const [captureState, setCaptureState] = useState<"waiting" | "cancelling" | null>(null);
  const captureRef = useRef<{ cancelled: boolean; cancel(): void } | null>(null);
  const captureCancelButton = useRef<HTMLButtonElement>(null);
  const captureFocusGroup = useRef<string | null>(null);
  const [uncommittedText, setUncommittedText] = useState(false);
  const clipboardInputVersion = useRef(0);
  const clipboardFocusVersion = useRef(0);
  const busyRef = useRef(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ groupId: string; imageId: string } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const clipboardDocumentRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const [zoom, setZoom] = useState(props.initialViewport?.zoom ?? 1);
  const autoFit = useRef(props.initialViewport?.autoFit ?? true);
  const initialViewport = useRef(props.initialViewport);
  const locked = disabled || busy;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      captureRef.current?.cancel();
    };
  }, []);
  useLayoutEffect(() => {
    if (captureState === "waiting") captureCancelButton.current?.focus();
  }, [captureState]);
  useEffect(() => {
    if (locked || !captureFocusGroup.current) return;
    // BlockNote may recreate node views when editability changes. Resolve the
    // current control after that update instead of retaining a detached button.
    const frame = requestAnimationFrame(() => {
      const group = Array.from(scrollerRef.current?.querySelectorAll("[data-image-group-id]") ?? [])
        .find((element) => element.getAttribute("data-image-group-id") === captureFocusGroup.current);
      group?.parentElement?.querySelector<HTMLButtonElement>('[data-image-capture]')?.focus();
      captureFocusGroup.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [locked, captureState]);

  const editor = useCreateBlockNote({
    schema: preshotBlockNoteSchema,
    dictionary: zh,
    initialContent: store.getSnapshot().plan.document.blocks as PreshotEditorPartialBlock[],
    trailingBlock: false,
    pasteHandler: () => true,
    disableExtensions: ["sideMenu", "suggestionMenu", "formattingToolbar", "filePanel", "linkToolbar", "history"],
    _tiptapOptions: {
      editorProps: {
        handlePaste: () => true,
        handleDrop: () => true,
        handleDOMEvents: { drop: (_view, event) => { event.preventDefault(); return true; } },
      },
    },
  });
  useLayoutEffect(() => lockMaterialContentEditor(editor), [editor]);
  useEffect(() => {
    const root = clipboardDocumentRef.current;
    if (!root) return;
    const unregister = registerImageClipboardDocument(root, {
      getNativeSelection: () => null, resolveNativeImage: () => null, getAnchor: () => null,
      getSelectedComponent: () => selectedClipboardComponent(editor, root),
    });
    const unsubscribe = editor.onSelectionChange(() => {
      root.dispatchEvent(new Event(IMAGE_CLIPBOARD_SELECTION_CHANGE, { bubbles: true }));
    });
    return () => { unsubscribe(); unregister(); };
  }, [editor]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      if (autoFit.current && scroller.clientWidth > 0) {
        setZoom(fitBlockNoteDocumentZoom(scroller.clientWidth));
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const position = initialViewport.current;
    if (!position) return;
    const frame = requestAnimationFrame(() => {
      if (scrollerRef.current) {
        scrollerRef.current.scrollTop = position.scrollTop;
        scrollerRef.current.scrollLeft = position.scrollLeft;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const readPayload = useCallback(() => {
    if (busyRef.current) throw new Error(ui("图片操作尚未完成，请稍候再保存。"));
    if (composingRef.current) throw new Error(ui("请先完成当前文字输入，再保存素材。"));
    try {
      drafts.flush();
      return store.readPayload();
    } catch (error) {
      throw new Error(ui("请修正素材内容后再保存：{{v0}}", { v0: error instanceof Error ? error.message : String(error) }), { cause: error });
    }
  }, [drafts, store]);
  useImperativeHandle(ref, () => ({
    readPayload,
    readViewport: () => ({
      zoom, autoFit: autoFit.current,
      scrollTop: scrollerRef.current?.scrollTop ?? 0,
      scrollLeft: scrollerRef.current?.scrollLeft ?? 0,
    }),
  }), [readPayload, zoom]);

  const report = useCallback((error: unknown) => {
    callbacks.current.onError(ui("素材内容编辑失败：{{v0}}", { v0: error instanceof Error ? error.message : String(error) }));
  }, []);

  const mutate = useCallback((action: () => void) => {
    if (callbacks.current.disabled || busyRef.current) return;
    try { action(); } catch (error) { report(error); }
  }, [report]);

  const runImageOperation = useCallback(async (action: () => Promise<void>) => {
    if (callbacks.current.disabled || busyRef.current) throw new Error(ui("正在保存或处理图片，请稍候再试。"));
    drafts.flush();
    busyRef.current = true;
    setBusy(true);
    callbacks.current.onBusyChange(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }, [drafts]);

  const imageController = useMemo<ImageGroupBlockController>(() => ({
    ...(library && repository.importEditImageData ? { insertImagesFromLibrary: (id: string) => {
      if (callbacks.current.disabled || busyRef.current) return;
      try { drafts.flush(); setLibraryTarget(id); } catch (error) { report(error); }
    } } : {}),
    structureEditable: false,
    singleImage: material.kind === "image",
    selectedImageId,
    subscribe: store.subscribe,
    createGroup: rejectStructure,
    cloneGroup: rejectStructure,
    getGroup: (id) => store.getSnapshot().groups.find((group) => group.id === id),
    getImageSrc: (file) => store.getSnapshot().sources[file],
    updateGroupMetadata: (id, update) => {
      if (!callbacks.current.disabled && !busyRef.current) store.updateGroup(id, update);
    },
    addImages: (id) => {
      void runImageOperation(async () => {
        const images = await repository.importEditImages(sessionId);
        if (mounted.current) store.addImages(id, images);
      }).catch(report);
    },
    captureImage: (id) => {
      captureFocusGroup.current = id;
      void runImageOperation(async () => {
        let resolveCancellation!: () => void;
        const cancellation = new Promise<void>((resolve) => { resolveCancellation = resolve; });
        const capture = {
          cancelled: false,
          cancel() {
            capture.cancelled = true;
            resolveCancellation();
            if (mounted.current) setCaptureState("cancelling");
          },
        };
        captureRef.current = capture;
        setCaptureState("waiting");
        try {
          const image = await repository.captureEditImage(sessionId, cancellation);
          if (mounted.current && !capture.cancelled && image) store.addImages(id, [image]);
        } finally {
          captureRef.current = null;
          if (mounted.current) setCaptureState(null);
        }
      }).catch(report);
    },
    removeImage: (groupId, imageId) => mutate(() => store.removeImage(groupId, imageId)),
    selectImage: (id) => { if (!callbacks.current.disabled && !busyRef.current) setSelectedImageId(id); },
    openImage: (groupId, imageId) => {
      if (!callbacks.current.disabled && !busyRef.current) setLightbox({ groupId, imageId });
    },
    setImageFrame: (groupId, imageId, frame) => mutate(() => store.setImageFrame(groupId, imageId, frame)),
    setImageFitMode: (groupId, imageId, fitMode) => mutate(() => store.setImageFitMode(groupId, imageId, fitMode)),
    moveImage: (from, imageId, to, index) => mutate(() => store.moveImage(from, imageId, to, index)),
  }), [store, selectedImageId, mutate, runImageOperation, report, repository, sessionId, material.kind, library, drafts]);

  const artifactController = useMemo<ArtifactBlockController>(() => ({
    kindLabels: materialArtifactLabels,
    structureEditable: false,
    subscribe: store.subscribe,
    createArtifact: rejectStructure,
    cloneArtifact: rejectStructure,
    getArtifact: (id) => store.getSnapshot().plan.artifacts.find((artifact) => artifact.id === id),
    updateArtifact: (id, update) => {
      if (!callbacks.current.disabled && !busyRef.current) store.updateArtifact(id, update);
    },
  }), [store]);

  const resolveClipboardImage = (selection: ImageClipboardSelection) => {
    if (selection.kind !== "gallery" || busyRef.current || callbacks.current.disabled || !mounted.current) {
      throw new Error(ui("当前素材图片不可复制，请完成编辑操作后重试。"));
    }
    const image = store.getSnapshot().groups.find(group => group.id === selection.groupId)
      ?.images.find(entry => entry.id === selection.imageId);
    if (!image) throw new Error(ui("选中的素材图片已不存在。"));
    const dataUrl = store.getSnapshot().sources[image.file];
    if (!dataUrl) throw new Error(ui("素材原图尚未加载，请稍候再复制。"));
    const { id: _id, file: _file, ...presentation } = image;
    return { dataUrl, name: ui("素材图片.png"), presentation };
  };

  const pasteClipboardImage = async (contents: ImageClipboardContents, target: ImagePasteTarget) => {
    if (target.kind !== "gallery") throw new Error(ui("只能粘贴到当前素材的图片区域，不能新增其他组件。"));
    const importer = repository.importEditImageData;
    if (!importer) throw new Error(ui("当前素材编辑服务不支持图片粘贴，请在桌面应用中重试。"));
    await runImageOperation(async () => {
      const revision = store.getSnapshot().revision;
      const group = store.getSnapshot().groups.find(entry => entry.id === target.groupId);
      if (!group || (target.afterImageId !== null && !group.images.some(image => image.id === target.afterImageId))) {
        throw new Error(ui("素材粘贴位置已变化，请重新选择。"));
      }
      if (group.images.length >= 128) throw new Error(ui("当前素材已达到 128 张图片上限。"));
      const asset = await clipboardPasteAsset(contents, target);
      if (!mounted.current || store.getSnapshot().revision !== revision) throw new Error(ui("素材编辑已结束或内容已变化。"));
      const imported = await importer(sessionId, asset.image);
      if (!mounted.current || store.getSnapshot().revision !== revision) throw new Error(ui("素材编辑已结束或内容已变化。"));
      const pasted = store.pasteImage(target.groupId, target.afterImageId, imported,
        asset.presentation, target.maxFrameWidth);
      setSelectedImageId(pasted.id);
      const focusVersion = clipboardFocusVersion.current;
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!mounted.current || clipboardFocusVersion.current !== focusVersion ||
            (active && active !== document.body && !scrollerRef.current?.contains(active))) return;
        scrollerRef.current?.querySelector<HTMLElement>(`[data-image-clipboard-id="${pasted.id}"]`)?.focus({ preventScroll: true });
      });
    });
    const revision = store.getSnapshot().revision;
    const inputVersion = clipboardInputVersion.current;
    return {
      undo() {
        if (!mounted.current || busyRef.current || callbacks.current.disabled ||
            store.getSnapshot().revision !== revision || clipboardInputVersion.current !== inputVersion) {
          throw new Error(ui("粘贴之后已有其他编辑，请使用素材画布的撤销功能。"));
        }
        history("undo");
      },
    };
  };

  const history = (direction: "undo" | "redo") => mutate(() => {
    try {
      drafts.flush();
    } catch (error) {
      if (direction !== "undo" || !(error instanceof ArtifactDraftValidationError)) throw error;
      drafts.reset();
      setUncommittedText(false);
      return;
    }
    drafts.reset();
    setUncommittedText(false);
    store[direction]();
  });
  const adjustZoom = (amount: number) => {
    autoFit.current = false;
    setZoom((value) => Math.min(BLOCKNOTE_MAX_ZOOM, Math.max(BLOCKNOTE_MIN_ZOOM, value + amount)));
  };
  const opened = lightbox && snapshot.groups.find(({ id }) => id === lightbox.groupId)
    ?.images.find(({ id }) => id === lightbox.imageId);
  const dimensions = opened ? store.getDimensions(opened.file) : null;

  return <section className="ml-content-canvas" aria-label={ui("素材内容编辑画布")} aria-busy={locked && !captureState}
    onPointerDownCapture={() => { clipboardFocusVersion.current += 1; }}
    onKeyDownCapture={(event) => {
      clipboardFocusVersion.current += 1;
      if (!event.currentTarget.contains(event.target as Node)) return;
      if (event.key === "Escape" && captureRef.current) {
        event.preventDefault();
        event.stopPropagation();
        captureRef.current.cancel();
        return;
      }
      if (event.nativeEvent.isComposing || composingRef.current) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation();
        history(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo");
      }
    }}
  >
    <div className="ml-content-canvas-toolbar" role="toolbar" aria-label={ui("素材画布工具")}>
      <button type="button" aria-label={ui("撤销")} disabled={locked || (!snapshot.canUndo && !uncommittedText)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => history("undo")}><Undo2 aria-hidden size={17} /></button>
      <button type="button" aria-label={ui("重做")} disabled={locked || !snapshot.canRedo || uncommittedText}
        onMouseDown={(event) => event.preventDefault()} onClick={() => history("redo")}><Redo2 aria-hidden size={17} /></button>
      <span aria-hidden className="ml-content-canvas-toolbar-divider" />
      <button type="button" aria-label={ui("缩小")} disabled={locked || zoom <= BLOCKNOTE_MIN_ZOOM} onClick={() => adjustZoom(-BLOCKNOTE_ZOOM_STEP)}><ZoomOut aria-hidden size={17} /></button>
      <output aria-label={ui("画布缩放")}>{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label={ui("放大")} disabled={locked || zoom >= BLOCKNOTE_MAX_ZOOM} onClick={() => adjustZoom(BLOCKNOTE_ZOOM_STEP)}><ZoomIn aria-hidden size={17} /></button>
      <button type="button" aria-label={ui("适应宽度")} disabled={locked} onClick={() => {
        autoFit.current = true;
        setZoom(fitBlockNoteDocumentZoom(scrollerRef.current?.clientWidth ?? BLOCKNOTE_DOCUMENT_WIDTH));
      }}><Maximize aria-hidden size={17} />{ui("适应宽度")}</button>
      <span className="ml-content-canvas-hint">{ui("仅编辑当前组件 · 不影响项目方案")}</span>
    </div>
    {captureState && <div className="ml-content-capture-status" role="status">
      <Camera size={18} aria-hidden />
      <p>{captureState === "waiting"
        ? ui("请选择截图区域，完成后将插入当前素材。可取消截图或按 Esc，编辑内容不会丢失。")
        : ui("正在取消截图并清理临时图片…")}</p>
      <button type="button" ref={captureCancelButton} disabled={captureState === "cancelling"}
        onClick={() => captureRef.current?.cancel()}>{ui("取消截图")}</button>
    </div>}
    <div className="ml-content-canvas-scroller editor-workspace-grid min-h-0 overflow-auto p-5"
      ref={scrollerRef}
      onCompositionStartCapture={() => { composingRef.current = true; }}
      onCompositionEndCapture={() => { composingRef.current = false; }}
      onInputCapture={() => { clipboardInputVersion.current += 1; setUncommittedText(true); }}
      onDropCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPasteCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-image-clipboard-scope]")) return;
        if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
          event.preventDefault(); event.stopPropagation();
        }
      }}
    >
      <fieldset disabled={locked} inert={locked} className="ml-content-canvas-paper relative mx-auto border-0 bg-white shadow-[0_12px_34px_rgb(27_30_35_/_14%)]"
        data-material-canvas-document=""
        style={{ padding: BLOCKNOTE_DOCUMENT_HORIZONTAL_PADDING, width: BLOCKNOTE_DOCUMENT_WIDTH, minHeight: 540, zoom }}>
        <ArtifactDraftContext.Provider value={drafts}>
          <ArtifactBlockContext.Provider value={artifactController}>
            <ImageGroupBlockContext.Provider value={imageController}>
              <ImageDragPreviewProvider enabled={!locked} imageGroups={snapshot.groups}
                imageGroupOrder={snapshot.groups.map(({ id }) => id)} imageSources={snapshot.sources}
                onMoveImage={imageController.moveImage} planRevision={snapshot.revision}
                projectKey={`material-edit:${sessionId}`} scrollContainerRef={scrollerRef}>
                <ImageClipboardScope port={imageClipboard ?? unavailableImageClipboard}
                  resolveImage={resolveClipboardImage} pasteImage={pasteClipboardImage}
                  disabled={disabled && !busy} onUndo={() => history("undo")}>
                <div ref={clipboardDocumentRef} className="preshot-blocknote-document" data-editor-engine="blocknote"
                  data-clipboard-document="" role="group" aria-label={ui("素材组件正文")}>
                  <BlockNoteView editor={editor} editable={!locked} theme="light"
                    slashMenu={false} sideMenu={false} formattingToolbar={false}
                    linkToolbar={false} filePanel={false} tableHandles={false} emojiPicker={false} />
                </div>
                </ImageClipboardScope>
              </ImageDragPreviewProvider>
            </ImageGroupBlockContext.Provider>
          </ArtifactBlockContext.Provider>
        </ArtifactDraftContext.Provider>
      </fieldset>
    </div>
    {opened && lightbox && dimensions ? <ReferenceImageLightbox
      src={snapshot.sources[opened.file]} alt={ui("参考图")} copyScope="draft" onClose={() => { if (!busyRef.current) setLightbox(null); }}
      cropAction={disabled ? undefined : {
        sourceWidth: dimensions.width, sourceHeight: dimensions.height,
        confirm: async (crop) => {
          try {
            await runImageOperation(async () => {
              const replacement = await repository.cropEditImage(sessionId, store.getToken(opened.file),
                cropPixels(crop, dimensions.width, dimensions.height));
              if (mounted.current) store.replaceImage(lightbox.groupId, lightbox.imageId, replacement);
            });
          } catch (error) {
            report(error);
            throw error;
          }
        },
      }}
    /> : null}
    {libraryTarget && library && <MaterialBrowser repository={library.repository}
      initialPreferences={{ query: "", filter: "all", sort: "auto", page: 0, selectedId: null }}
      onPreferencesChange={() => undefined} onClose={() => setLibraryTarget(null)}
      input={{ imagesOnly: true, targetLabel: ui("当前素材的图片组「{{v0}}」", { v0: store.getSnapshot().groups.find((group) => group.id === libraryTarget)?.name || ui("未命名") }),
        onInsert: async (selected, selection) => {
          await runImageOperation(async () => {
            const revision = store.getSnapshot().revision;
            const group = store.getSnapshot().groups.find((group) => group.id === libraryTarget);
            if (!group) throw new Error(ui("目标图片组已不存在。"));
            const result = await importMaterialImages({ library: library.repository, editor: repository, sessionId,
              material: selected, selection, remaining: 128 - group.images.length,
              isCurrent: () => mounted.current && store.getSnapshot().revision === revision });
            if (mounted.current) store.addImages(libraryTarget, result.images, result.visuals);
          });
        },
      }} />}
  </section>;
}
