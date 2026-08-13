import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import type { ReferenceComponent } from "../../../domain/plan/canvas/models";
import {
  A4,
  contentSize,
  DEFAULT_PAGE_GEOMETRY,
} from "../../../domain/plan/canvas/geometry";
import { RichTextEditor } from "../RichTextEditor";
import { PagedCanvasSurface } from "./PagedCanvasSurface";
import { PAGE_SCREEN_GAP } from "./pagedCanvasMetrics";
import type { BlankLineInsertAnchor } from "../DocumentImageGroupExtension";
import type { DocumentPaginationOptions } from "../DocumentPaginationExtension";

interface PlanDocumentCanvasProps {
  documentHtml: string;
  imageGroups: readonly ReferenceComponent[];
  imageSrc(file: string): string | undefined;
  onAddImages(id: string): void;
  onChangeDocumentHtml(html: string): void;
  onCreateImageGroup(id: string): void;
  onOpenImage(componentId: string, imageId: string, file: string): void;
  onRemoveImage(componentId: string, imageId: string): void;
  onRemoveImageGroup(id: string): void;
  onResizeImageGroup(
    id: string,
    rect: { x?: number; width?: number; height?: number },
  ): void;
  onSetImageFrame(
    componentId: string,
    imageId: string,
    frame: { frameWidth: number; frameHeight: number },
  ): void;
  onScaleImages(id: string, scale: number): void;
  scale: number;
}

export function PlanDocumentCanvas({
  documentHtml,
  imageGroups,
  imageSrc,
  onAddImages,
  onChangeDocumentHtml,
  onCreateImageGroup,
  onOpenImage,
  onRemoveImage,
  onRemoveImageGroup,
  onResizeImageGroup,
  onSetImageFrame,
  onScaleImages,
  scale,
}: PlanDocumentCanvasProps) {
  const [insertOpen, setInsertOpen] = useState(false);
  const [blankInsertAnchor, setBlankInsertAnchor] = useState<BlankLineInsertAnchor | null>(null);
  const [blankInsertMenuOpen, setBlankInsertMenuOpen] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const insertControlRef = useRef<HTMLDivElement | null>(null);
  const blankInsertControlRef = useRef<HTMLDivElement | null>(null);
  const insertImageGroupRef = useRef<(() => void) | null>(null);
  const insertImageGroupAtRef = useRef<((position: number) => void) | null>(null);
  const paginatorRef = useRef<((options: DocumentPaginationOptions, onComplete: (pageCount: number) => void) => () => void) | null>(null);
  const cancelPaginationRef = useRef<(() => void) | null>(null);
  const observedWidthRef = useRef(0);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const geometry = DEFAULT_PAGE_GEOMETRY;
  const content = contentSize(geometry);
  const marginPx = geometry.margin * safeScale;

  useEffect(() => {
    if (!insertOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && insertControlRef.current?.contains(event.target)) return;
      setInsertOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [insertOpen]);

  useEffect(() => {
    if (!blankInsertAnchor) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && blankInsertControlRef.current?.contains(event.target)) return;
      setBlankInsertAnchor(null);
      setBlankInsertMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [blankInsertAnchor]);

  const activateBlankLine = useCallback((anchor: BlankLineInsertAnchor | null) => {
    setBlankInsertAnchor(anchor);
    setBlankInsertMenuOpen(false);
  }, []);

  const repaginate = useCallback(() => {
    const paginate = paginatorRef.current;
    if (!paginate) return;
    cancelPaginationRef.current?.();
    cancelPaginationRef.current = paginate({
      pageHeight: A4.height,
      pageMargin: geometry.margin,
      titleHeight: 0,
      pageGap: PAGE_SCREEN_GAP,
      scale: safeScale,
    }, (pages) => setPageCount((current) => current === pages ? current : pages));
  }, [geometry.margin, safeScale]);

  const registerInsertImageGroup = useCallback((insert: (() => void) | null) => {
    insertImageGroupRef.current = insert;
  }, []);
  const registerInsertImageGroupAt = useCallback((insert: ((position: number) => void) | null) => {
    insertImageGroupAtRef.current = insert;
  }, []);
  const registerPaginator = useCallback((paginate: ((options: DocumentPaginationOptions, onComplete: (pageCount: number) => void) => () => void) | null) => {
    paginatorRef.current = paginate;
    if (!paginate) return;
    cancelPaginationRef.current?.();
    cancelPaginationRef.current = paginate({
      pageHeight: A4.height,
      pageMargin: geometry.margin,
      titleHeight: 0,
      pageGap: PAGE_SCREEN_GAP,
      scale: safeScale,
    }, (pages) => setPageCount((current) => current === pages ? current : pages));
  }, [geometry.margin, safeScale]);

  useLayoutEffect(() => {
    const root = editorRootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? root.getBoundingClientRect().width;
      if (Math.abs(width - observedWidthRef.current) < 0.5) return;
      observedWidthRef.current = width;
      repaginate();
    });
    const mutationObserver = new MutationObserver((mutations) => {
      const paginationOnly = mutations.every((mutation) =>
        mutation.type === "childList" &&
        mutation.addedNodes.length + mutation.removedNodes.length > 0 &&
        Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes)).every((node) =>
          node instanceof HTMLElement && node.classList.contains("preshot-document-page-spacer")));
      if (paginationOnly) return;
      window.setTimeout(repaginate, 0);
    });
    observer.observe(root);
    mutationObserver.observe(root, { characterData: true, childList: true, subtree: true });
    observedWidthRef.current = root.getBoundingClientRect().width;
    repaginate();
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      cancelPaginationRef.current?.();
    };
  }, [documentHtml, imageGroups, repaginate]);

  return (
    <>
      <div
      className="relative mx-auto"
      data-testid="plan-document-canvas"
      style={{ width: `${A4.width * safeScale}px` }}
    >
      <div className="relative z-30 mb-2 h-9" ref={insertControlRef}>
        <button
          aria-expanded={insertOpen}
          aria-haspopup="menu"
          className="flex h-8 items-center gap-1 rounded-md border border-white/10 bg-[#202329] px-3 text-xs font-bold text-white shadow-md hover:bg-[#343840] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
          onClick={() => setInsertOpen((open) => !open)}
          type="button"
        >
          <Plus aria-hidden size={14} />插入<ChevronDown aria-hidden size={13} />
        </button>
        {insertOpen ? (
          <div
            className="absolute left-0 top-9 w-44 rounded-md border border-[#3b3f47] bg-[#202329] p-1 text-white shadow-[0_10px_28px_rgb(0_0_0_/_25%)]"
            role="menu"
          >
            <button
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-white/10"
              onClick={() => {
                setInsertOpen(false);
                insertImageGroupRef.current?.();
              }}
              role="menuitem"
              type="button"
            >
              图片组
            </button>
          </div>
        ) : null}
      </div>
      <PagedCanvasSurface pageCount={pageCount} scale={safeScale}>
        <div
          className="absolute z-10"
          style={{
            left: `${marginPx}px`,
            top: `${marginPx}px`,
            width: `${content.width * safeScale}px`,
          }}
        >
          <div
            ref={editorRootRef}
            style={{
              width: `${content.width}px`,
              transform: `scale(${safeScale})`,
              transformOrigin: "left top",
            }}
          >
            <RichTextEditor
              ariaLabel="方案正文"
              documentMode={{
                imageGroups,
                imageSrc,
                onAddImages,
                onCreateImageGroup,
                onOpenImage,
                onRemoveImage,
                onRemoveImageGroup,
                onResizeImageGroup,
                onSetImageFrame,
                onScaleImages,
                scale: safeScale,
                  onActivateBlankLine: activateBlankLine,
                registerInsertImageGroup,
                registerInsertImageGroupAt,
                registerPaginator,
              }}
              html={documentHtml}
              onChange={onChangeDocumentHtml}
              placeholder="开始写拍摄计划……"
            />
          </div>
        </div>
      </PagedCanvasSurface>
      </div>
      {blankInsertAnchor ? createPortal(
        <div
          data-preshot-surface="true"
          ref={blankInsertControlRef}
          style={{
            left: `${Math.max(8, blankInsertAnchor.left - 32 * safeScale)}px`,
            position: "fixed",
            top: `${blankInsertAnchor.top}px`,
            zIndex: 1000,
          }}
        >
          <button
            aria-expanded={blankInsertMenuOpen}
            aria-haspopup="menu"
            aria-label="在空白行插入组件"
            className="preshot-document-blank-insert-control"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setBlankInsertMenuOpen((open) => !open);
            }}
            title="在空白行插入组件"
            type="button"
            style={{ height: `${22 * safeScale}px`, width: `${22 * safeScale}px` }}
          >
            +
          </button>
          {blankInsertMenuOpen ? (
            <div
              aria-label="选择组件"
              className="preshot-document-blank-insert-menu"
              role="menu"
              style={{ left: `${28 * safeScale}px`, top: "0" }}
            >
              <button
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  insertImageGroupAtRef.current?.(blankInsertAnchor.position);
                  setBlankInsertMenuOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                图片组
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}