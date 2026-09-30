import { createImageBlockConfig, imageParse } from "@blocknote/core";
import { createReactBlockSpec, ImageBlock, useResolveUrl, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { closeHistory } from "prosemirror-history";
import { nativeImagePresentation, nativeImagePresentationProps } from "../../../domain/plan/canvas/nativeImagePresentation";
import { imageFrameContentCss } from "../../../domain/plan/canvas/imageView";
import { IMAGE_RESIZE_DIRECTIONS, resizeHandleStyle, type ResizeDirection } from "./imageGroupInteraction";
import { ui } from "../../../shared/i18n/ui";
import { imageAssetKey } from "../../../domain/plan/canvas/imagePresentation";

const config = {
  ...createImageBlockConfig({}),
  propSchema: { ...createImageBlockConfig({}).propSchema,
    presentationAxes: { default: "", values: ["", "raw", "exif"] as const },
    previewHeight: { default: 0 }, fitMode: { default: "cover", values: ["cover", "stretch"] as const },
    cropX: { default: 0 }, cropY: { default: 0 }, cropWidth: { default: 1 }, cropHeight: { default: 1 },
  },
} as const;

function PreshotImage(props: ReactCustomBlockRenderProps<typeof config>) {
  if (!props.block.props.url || !props.block.props.showPreview) return <ImageBlock {...(props as unknown as Parameters<typeof ImageBlock>[0])} />;
  return <PreshotImageFrame {...props} />;
}

function PreshotImageFrame(props: ReactCustomBlockRenderProps<typeof config>) {
  const { block, editor } = props;
  const root = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [natural, setNatural] = useState({ width: 600, height: 400 });
  const [preview, setPreview] = useState<{ width: number; height: number } | null>(null);
  const resolved = useResolveUrl(imageAssetKey(block.props.url, block.props.presentationAxes === "exif" ? "exif" : undefined));
  useEffect(() => () => cleanup.current?.(), []);
  const image = nativeImagePresentation(preview ? { ...block.props, previewWidth: preview.width, previewHeight: preview.height } : block.props, natural.width, natural.height);
  const width = preview?.width ?? image.frameWidth;
  const height = preview?.height ?? image.frameHeight;
  const commit = (nextWidth: number, nextHeight: number) => {
    editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
    editor.updateBlock(block, { props: { previewWidth: nextWidth, previewHeight: nextHeight } });
    editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
  };
  const resize = (direction: ResizeDirection, event: React.PointerEvent) => {
    if (event.button !== 0 || !editor.isEditable || root.current?.closest("[inert]")) return;
    cleanup.current?.();
    const rect = root.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    event.preventDefault(); event.stopPropagation();
    const scale = rect.width / width;
    const startX = event.clientX, startY = event.clientY;
    const pointerId = event.pointerId;
    let active = true;
    let next = { width, height };
    const isCurrent = () => {
      const current = editor.getBlock(block.id);
      return Boolean(root.current?.isConnected && !root.current.closest("[inert]") &&
        editor.isEditable && current?.type === "image" && JSON.stringify(current.props) === JSON.stringify(block.props));
    };
    const calculate = (dx: number, dy: number) => {
      let w = width + (direction.includes("left") ? -dx : direction.includes("right") ? dx : 0);
      let h = height + (direction.includes("top") ? -dy : direction.includes("bottom") ? dy : 0);
      if (direction.includes("-")) {
        const factor = Math.max(24 / width, 24 / height, Math.abs(w / width - 1) >= Math.abs(h / height - 1) ? w / width : h / height);
        w = width * factor; h = height * factor;
      }
      next = { width: Math.max(24, w), height: Math.max(24, h) }; setPreview(next);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!isCurrent()) { cancel(); return; }
      calculate((e.clientX - startX) / scale, (e.clientY - startY) / scale);
    };
    const finish = (save: boolean) => {
      if (!active) return;
      active = false;
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", pointerCancel); document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      cleanup.current = null; setPreview(null);
      if (save && isCurrent()
        && (next.width !== width || next.height !== height)) commit(next.width, next.height);
    };
    const end = (e: PointerEvent) => { if (e.pointerId === pointerId) { move(e); finish(true); } };
    const cancel = () => finish(false);
    const pointerCancel = (e: PointerEvent) => { if (e.pointerId === pointerId) cancel(); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isCurrent()) { e.preventDefault(); e.stopPropagation(); }
      cancel();
    };
    cleanup.current = cancel;
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", pointerCancel); document.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
  };
  return <figure className="bn-file-block-content-wrapper preshot-native-image" contentEditable={false} style={{ margin: 0, maxWidth: "100%" }}>
    <div className="bn-visual-media-wrapper bn-drag-exclude" ref={root} tabIndex={0}
      onKeyDown={event => {
        if (!editor.isEditable || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key !== "z" && key !== "y") return;
        event.preventDefault(); event.stopPropagation();
        if (key === "y" || event.shiftKey) editor.redo(); else editor.undo();
      }}
      style={{ position: "relative", width, maxWidth: "100%", aspectRatio: `${width} / ${height}` }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <img className="bn-visual-media" alt={block.props.name} src={resolved.downloadUrl} draggable={false}
          onLoad={e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          style={{ position: "absolute", maxWidth: "none", ...imageFrameContentCss({ ...image, frameWidth: width, frameHeight: height }) }} />
      </div>
      {editor.isEditable && <>
        <span className="preshot-native-resize-hint">{ui("拖动四角等比缩放，拖动边缘调整宽高；Esc 取消")}</span>
        <button type="button" className="preshot-native-fit" onPointerDown={e => e.stopPropagation()}
          onClick={() => editor.updateBlock(block, { props: { fitMode: block.props.fitMode === "stretch" ? "cover" : "stretch" } })}>
          {block.props.fitMode === "stretch" ? ui("裁切适配") : ui("自由变形")}
        </button>
        {IMAGE_RESIZE_DIRECTIONS.map(direction => <span key={direction} role="separator" tabIndex={0}
          aria-label={ui("从{{v0}}调整图片", { v0: direction })} data-image-resize-edge={direction}
          className="preshot-image-resize-zone" style={resizeHandleStyle(direction)} onPointerDown={e => resize(direction, e)}
          onKeyDown={e => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            const dx = e.key === "ArrowRight" ? 4 : e.key === "ArrowLeft" ? -4 : 0;
            const dy = e.key === "ArrowDown" ? 4 : e.key === "ArrowUp" ? -4 : 0;
            if ((direction === "left" || direction === "right") && !dx || (direction === "top" || direction === "bottom") && !dy) return;
            e.preventDefault(); e.stopPropagation();
            let w = Math.max(24, width + (direction.includes("left") ? -dx : direction.includes("right") ? dx : 0));
            let h = Math.max(24, height + (direction.includes("top") ? -dy : direction.includes("bottom") ? dy : 0));
            if (direction.includes("-")) {
              const factor = Math.max(24 / width, 24 / height, dx ? w / width : h / height);
              w = width * factor; h = height * factor;
            }
            commit(w, h);
          }} />)}
      </>}
    </div>
    {block.props.caption && <figcaption>{block.props.caption}</figcaption>}
  </figure>;
}

export const preshotImageBlockSpec = createReactBlockSpec(config, {
  meta: { fileBlockAccept: ["image/*"] }, render: PreshotImage,
  parse: element => {
    const parsed = imageParse()(element);
    if (!parsed) return undefined;
    const visual = element.getAttribute("data-preshot-presentation");
    if (!visual) return parsed;
    try { return { ...parsed, ...nativeImagePresentationProps(nativeImagePresentation(JSON.parse(visual), 600, 400)) }; }
    catch { return parsed; }
  },
  toExternalHTML: ({ block }) => <img src={block.props.url} alt={block.props.name} width={block.props.previewWidth}
    height={block.props.previewHeight || undefined} data-preshot-presentation={JSON.stringify({
      previewWidth: block.props.previewWidth, previewHeight: block.props.previewHeight, fitMode: block.props.fitMode,
      cropX: block.props.cropX, cropY: block.props.cropY, cropWidth: block.props.cropWidth, cropHeight: block.props.cropHeight,
      presentationAxes: block.props.presentationAxes,
    })} />,
});
