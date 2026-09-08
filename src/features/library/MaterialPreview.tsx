import { useEffect, useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import type { MaterialDetail, MaterialPayload, MaterialSummary } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { materialPayloadText, materialPayloadTitle } from "../../domain/library";

export function MaterialTextPreview({ payload }: { payload: MaterialPayload }) {
  return <div className="ml-text-preview">
    <h3>{materialPayloadTitle(payload) || "未命名组件"}</h3>
    <p>{materialPayloadText(payload) || "此组件没有文字说明。"}</p>
  </div>;
}

export function MaterialPreview({
  material, renderPreview,
}: {
  material: MaterialDetail;
  renderPreview?: (material: MaterialDetail) => ReactNode;
}) {
  return <section className="ml-preview" aria-label="组件只读预览">
    {renderPreview ? renderPreview(material) : <>
      <MaterialTextPreview payload={material.payload} />
      <p className="ml-muted">当前显示文字预览；完整图片预览尚不可用，缩略图不是原始内容。</p>
    </>}
  </section>;
}

export function MaterialThumbnail({
  material, repository, refresh = 0,
}: {
  material: MaterialSummary;
  repository: MaterialLibraryRepository;
  refresh?: number;
}) {
  const [preview, setPreview] = useState<{ key: string; url: string | null; status: "loading" | "ready" | "missing" | "failed" }>({
    key: "", url: null, status: "loading",
  });
  const key = `${material.id}:${material.revision}:${refresh}`;
  useEffect(() => {
    let current = true;
    repository.loadPreview(material.id, material.revision).then((url) => {
      if (current) setPreview({ key, url, status: url ? "ready" : "missing" });
    }, () => {
      if (current) setPreview({ key, url: null, status: "failed" });
    });
    return () => { current = false; };
  }, [repository, material.id, material.revision, key]);
  const status = preview.key === key ? preview.status : "loading";
  const label = status === "loading" ? "缩略图加载中" :
    status === "failed" || material.previewState === "failed" ? "缩略图不可用" : "尚未生成缩略图";
  return <span className="ml-thumbnail">
    {status === "ready" && preview.url ? <img
      src={preview.url}
      alt={`${material.name}的${material.previewPartial ? "局部" : "组件"}缩略图`}
      loading="lazy"
      onError={() => setPreview({ key, url: null, status: "failed" })}
    /> : <span className="ml-thumbnail-placeholder">
      <ImageOff size={24} aria-hidden="true" /><span>{label}</span>
    </span>}
    {material.previewPartial && <span className="ml-preview-partial">局部缩略图 · 请查看完整预览</span>}
  </span>;
}
