import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { useEffect, useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import type { MaterialDetail, MaterialPayload, MaterialSummary } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { materialPayloadText, materialPayloadTitle } from "../../domain/library";

export function MaterialTextPreview({ payload }: { payload: MaterialPayload }) {
  useUiLanguage();
  return <div className="ml-text-preview">
    <h3>{materialPayloadTitle(payload) || ui("未命名组件")}</h3>
    <p>{materialPayloadText(payload) || ui("此组件没有文字说明。")}</p>
  </div>;
}

export function MaterialPreview({
  material, renderPreview,
}: {
  material: MaterialDetail;
  renderPreview?: (material: MaterialDetail) => ReactNode;
}) {
  useUiLanguage();
  return <section className="ml-preview" aria-label={ui("组件只读预览")}>
    {renderPreview ? renderPreview(material) : <>
      <MaterialTextPreview payload={material.payload} />
      <p className="ml-muted">{ui("当前显示文字预览；完整图片预览尚不可用，缩略图不是原始内容。")}</p>
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
  useUiLanguage();
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
  const label = status === "loading" ? ui("缩略图加载中") :
    status === "failed" || material.previewState === "failed" ? ui("缩略图不可用") : ui("尚未生成缩略图");
  return <span className="ml-thumbnail">
    {status === "ready" && preview.url ? <img
      src={preview.url}
      alt={ui("{{v0}}的{{v1}}缩略图", { v0: material.name, v1: material.previewPartial ? ui("局部") : ui("组件") })}
      loading="lazy"
      onError={() => setPreview({ key, url: null, status: "failed" })}
    /> : <span className="ml-thumbnail-placeholder">
      <ImageOff size={24} aria-hidden="true" /><span>{label}</span>
    </span>}
    {material.previewPartial && <span className="ml-preview-partial">{ui("局部缩略图 · 请查看完整预览")}</span>}
  </span>;
}
