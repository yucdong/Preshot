import { Children, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { DEFAULT_ARTIFACT_CONTENT_LAYOUT, resolveArtifactContentLayout, type ArtifactContentLayout } from "../../../domain/plan/canvas/artifactContentLayout";
import type { ArtifactRecord } from "../../../domain/plan/canvas/blockDocument";
import { ui } from "../../../shared/i18n/ui";

export function ArtifactContentRegions({ artifact, children, update }: {
  artifact: ArtifactRecord; children: ReactNode; update?(value: ArtifactRecord): void;
}) {
  const currentArtifact = useRef(artifact);
  useEffect(() => { currentArtifact.current = artifact; }, [artifact]);
  const root = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [width, setWidth] = useState(900);
  const [preview, setPreview] = useState<ArtifactContentLayout | null>(null);
  const heightTransaction = useRef<{ artifact: ArtifactRecord; value: ArtifactContentLayout } | null>(null);
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(root.current?.clientWidth ?? 900));
    observer.observe(root.current);
    return () => { observer.disconnect(); cleanup.current?.(); };
  }, []);
  if (artifact.kind === "modelCard") return <div className="preshot-artifact-balanced-layout">{children}</div>;
  const stored = preview ?? artifact.contentLayout ?? DEFAULT_ARTIFACT_CONTENT_LAYOUT;
  const layout = resolveArtifactContentLayout(stored, width);
  const parts = Children.toArray(children);
  const firstShare = layout.textFirst ? layout.textShare : 1 - layout.textShare;
  const horizontal = layout.orientation === "horizontal";
  const commit = (next: ArtifactContentLayout) => update?.({ ...artifact, contentLayout: next });
  const finishHeight = (save: boolean) => {
    const transaction = heightTransaction.current;
    heightTransaction.current = null;
    setPreview(null);
    if (save && transaction?.artifact === artifact &&
      transaction.value.minHeight !== (artifact.contentLayout ?? DEFAULT_ARTIFACT_CONTENT_LAYOUT).minHeight) {
      commit(transaction.value);
    }
  };
  const drag = (event: React.PointerEvent) => {
    if (event.button !== 0 || root.current?.closest("[inert]")) return;
    cleanup.current?.();
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds || (horizontal ? bounds.width : bounds.height) <= 0) return;
    event.preventDefault(); event.stopPropagation();
    const pointerId = event.pointerId;
    let active = true;
    let next = stored;
    const isCurrent = () => Boolean(root.current?.isConnected && !root.current.closest("[inert]") &&
      currentArtifact.current === artifact);
    const finish = (save: boolean) => {
      if (!active) return;
      active = false;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", pointerCancel);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      cleanup.current = null; setPreview(null);
      if (save && isCurrent() && next.textShare !== stored.textShare) commit(next);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!isCurrent()) { cancel(); return; }
      const fraction = horizontal ? (e.clientX - bounds.left) / bounds.width : (e.clientY - bounds.top) / bounds.height;
      next = { ...stored, textShare: Math.max(0.1, Math.min(0.9, layout.textFirst ? fraction : 1 - fraction)) };
      setPreview(next);
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
  const style: CSSProperties = horizontal ? {
    display: "grid", gridTemplateColumns: `minmax(0, ${firstShare}fr) 8px minmax(0, ${1 - firstShare}fr)`, gap: 6,
  } : { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 };
  return <section className="preshot-card-regions">
    {update && <div className="preshot-card-layout-controls" contentEditable={false}>
      <button type="button" onClick={() => commit({ ...stored, orientation: "vertical" })}>{ui("上下排版")}</button>
      <button type="button" onClick={() => commit({ ...stored, orientation: "horizontal" })}>{ui("左右排版")}</button>
      <button type="button" onClick={() => commit({ ...stored, textFirst: !layout.textFirst })}>{ui("交换图文位置")}</button>
      <label>{ui("区域高度")}<input type="range" min="160" max="1200" step="20" value={layout.minHeight}
        onChange={e => {
          const value = { ...stored, minHeight: Number(e.target.value) };
          heightTransaction.current = { artifact: heightTransaction.current?.artifact ?? artifact, value };
          setPreview(value);
        }}
        onPointerDown={e => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          heightTransaction.current = { artifact, value: stored };
        }}
        onPointerUp={() => finishHeight(true)}
        onPointerCancel={() => finishHeight(false)}
        onBlur={() => finishHeight(false)}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishHeight(false); }
        }}
        onKeyUp={e => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) finishHeight(true);
        }} /></label>
    </div>}
    <div ref={root} style={style} data-card-orientation={layout.orientation}>
      <div style={{ minWidth: 0, minHeight: horizontal ? layout.minHeight : layout.minHeight * firstShare }}>{parts[layout.textFirst ? 0 : 1]}</div>
      {update ? <div role="separator" tabIndex={0} aria-label={ui("调整图文比例")}
        aria-orientation={horizontal ? "vertical" : "horizontal"} className="preshot-card-divider"
        style={{ cursor: horizontal ? "col-resize" : "row-resize", minHeight: 8 }} onPointerDown={drag}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const direction = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
          commit({ ...stored, textShare: Math.max(0.1, Math.min(0.9, layout.textShare + direction * (layout.textFirst ? 0.05 : -0.05))) });
        }} /> : <div aria-hidden />}
      <div style={{ minWidth: 0, minHeight: horizontal ? layout.minHeight : layout.minHeight * (1 - firstShare) }}>{parts[layout.textFirst ? 1 : 0]}</div>
    </div>
  </section>;
}
