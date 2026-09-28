import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { useRef, useState } from "react";
import type { MaterialDetail } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { materialPayloadTitle } from "../../domain/library";
import type { MaterialSaveInput } from "./MaterialLibraryContext";
import { LibraryDialog } from "./LibraryDialog";
import { MaterialMetadataForm } from "./MaterialMetadataForm";
import { MaterialTextPreview } from "./MaterialPreview";
import { libraryError, materialKindLabels, useLibraryLifetime } from "./libraryUi";

export function MaterialSaveDialog({
  repository, input, onClose, createPreview,
}: {
  repository: MaterialLibraryRepository;
  input: MaterialSaveInput;
  onClose(): void;
  createPreview?: (material: MaterialDetail) => Promise<void>;
}) {
  useUiLanguage();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<MaterialDetail | null>(null);
  const savedRef = useRef<MaterialDetail | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [phase, setPhase] = useState("");
  const alive = useLibraryLifetime();
  const retryLock = useRef(false);
  const finishPreview = async (detail: MaterialDetail) => {
    if (!createPreview) {
      if (alive.current) {
        setPhase(ui("内容已保存，缩略图尚未生成；可在素材库中稍后重试。"));
        setPreviewError(ui("素材已保存；当前无法生成缩略图，不影响原始内容。"));
      }
      return;
    }
    if (alive.current) setPhase(ui("内容已保存，正在准备缩略图…"));
    try {
      await createPreview(detail);
      if (alive.current) onClose();
    } catch (error) {
      if (alive.current) {
        setPhase(ui("素材内容已保存。"));
        setPreviewError(libraryError(error, ui("缩略图生成失败；文字和图片已安全保存，无需再次保存")));
      }
    }
  };
  return <LibraryDialog title={ui("保存到素材库")} subtitle={ui("保存独立的文字和图片副本，跨项目重复使用。")}
    className="ml-save-dialog" busy={busy} onClose={onClose}>
    <MaterialMetadataForm
      repository={repository}
      initial={{ name: materialPayloadTitle(input.snapshot.payload), description: "", tags: [], favorite: false }}
      onClose={() => { if (!busy) onClose(); }}
      submitLabel={ui("保存素材")}
      confirmDuplicateName
      omittedLegacyImages={input.snapshot.omittedLegacyImages}
      disabled={Boolean(saved)}
      externalBusy={busy}
      footerStatus={phase}
      preview={<>
        <p className="ml-muted">{ui("来源项目：")}{input.projectName}</p>
        <MaterialTextPreview payload={input.snapshot.payload} />
        <p>{materialKindLabels[input.snapshot.payload.kind]} · {input.snapshot.sources.length} {ui("张图片")}</p>
        <p className="ml-help">{ui("图片体积和完整性将在保存时校验。")}</p>
        <p className="ml-help">{ui("保存组件的完整文字、图片顺序、画框和裁切。原项目删除后，素材仍可使用。")}</p>
        {previewError && <p className="ml-banner" role="alert">{previewError}</p>}
      </>}
      extraActions={saved && createPreview && previewError ? <button type="button" disabled={busy} onClick={() => {
        if (retryLock.current) return;
        retryLock.current = true;
        setBusy(true);
        void finishPreview(saved).finally(() => {
          retryLock.current = false;
          if (alive.current) setBusy(false);
        });
      }}>{ui("重试生成缩略图")}</button> : undefined}
      onSubmit={async (metadata) => {
        if (savedRef.current) return;
        setBusy(true);
        setPhase(ui("正在复制图片并保存素材，请勿关闭…"));
        try {
          const detail = await input.onSave(metadata);
          savedRef.current = detail;
          if (!alive.current) return;
          setSaved(detail);
          await finishPreview(detail);
        } catch (error) {
          if (alive.current) setPhase("");
          throw error;
        } finally {
          if (alive.current) setBusy(false);
        }
      }}
    />
  </LibraryDialog>;
}
