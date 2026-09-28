import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { MaterialMetadata } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { materialNameExists } from "../../domain/library";
import { MaterialDuplicateNameDialog } from "./MaterialDuplicateNameDialog";
import { MaterialMetadataFields } from "./MaterialMetadataFields";
import { createMetadataDraft, readMetadataDraft } from "./materialMetadataDraft";
import { libraryError, metadataValidationError, unavailableMessage, useLibraryLifetime } from "./libraryUi";

export function MaterialMetadataForm({
  repository, initial, excludeId, submitLabel, onSubmit, onClose,
  preview, omittedLegacyImages = 0, disabled = false, externalBusy = false, footerStatus, extraActions,
  confirmDuplicateName = false,
}: {
  repository: MaterialLibraryRepository;
  initial: MaterialMetadata;
  excludeId?: string;
  submitLabel: string;
  onSubmit(metadata: MaterialMetadata): Promise<void>;
  onClose(): void;
  preview?: ReactNode;
  omittedLegacyImages?: number;
  disabled?: boolean;
  externalBusy?: boolean;
  footerStatus?: string;
  extraActions?: ReactNode;
  confirmDuplicateName?: boolean;
}) {
  useUiLanguage();
  const [draft, setDraft] = useState(() => createMetadataDraft(initial));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingName, setCheckingName] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<MaterialMetadata | null>(null);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<string>();
  const [duplicate, setDuplicate] = useState<{ name: string; found: boolean; failed: boolean }>();
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const lock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const alive = useLibraryLifetime();
  const id = useId();
  const normalizedName = draft.name.normalize("NFC").trim();
  const unavailable = repository.availability === "unavailable";
  const operating = busy || externalBusy;

  useEffect(() => {
    if (unavailable || composing || !normalizedName) return;
    let current = true;
    const timer = window.setTimeout(() => {
      materialNameExists(repository, normalizedName, excludeId).then(
        (found) => {
          if (current) setDuplicate({
            name: normalizedName,
            found,
            failed: false,
          });
        },
        () => { if (current) setDuplicate({ name: normalizedName, found: false, failed: true }); },
      );
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [repository, unavailable, composing, normalizedName, excludeId]);

  const submit = async (metadata: MaterialMetadata, duplicateConfirmed = false) => {
    if (lock.current || operating || disabled || unavailable || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let checking = confirmDuplicateName && !duplicateConfirmed;
    setCheckingName(checking);
    try {
      if (checking) {
        const found = await materialNameExists(repository, metadata.name);
        if (!alive.current) return;
        if (found) {
          setPendingDuplicate(metadata);
          return;
        }
      }
      checking = false;
      setCheckingName(false);
      setPendingDuplicate(null);
      await onSubmit(metadata);
    } catch (failure) {
      if (alive.current) setError(libraryError(failure,
        checking ? ui("无法检查同名素材，请重试后保存") : ui("保存未完成")));
    } finally {
      lock.current = false;
      if (alive.current) {
        setCheckingName(false);
        setBusy(false);
      }
    }
  };

  return <><form ref={form} className="ml-metadata-form" noValidate
    onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
    onCompositionEnd={() => { composingRef.current = false; setComposing(false); }}
    onKeyDown={(event) => {
      if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)) {
        event.preventDefault();
      }
    }}
    onSubmit={(event) => {
      event.preventDefault();
      if (lock.current || operating || disabled || unavailable || composingRef.current) return;
      setError("");
      setInvalidField(undefined);
      let metadata: MaterialMetadata;
      try {
        metadata = readMetadataDraft(draft);
        if (omittedLegacyImages > 0 && !confirmed) {
          setError(ui("请先确认仅保存可见主图库，不包含旧版试穿参考。"));
          form.current?.querySelector<HTMLInputElement>('[name="confirm-legacy"]')?.focus();
          return;
        }
      } catch (failure) {
        const validation = metadataValidationError(failure);
        setError(validation.message);
        setInvalidField(validation.field);
        form.current?.querySelector<HTMLElement>(`[name="material-${validation.field}"]`)?.focus();
        return;
      }
      void submit(metadata);
    }}>
    <div className={`ml-form-body${preview ? " ml-form-with-preview" : ""}`}>
      {preview && <aside className="ml-save-preview">{preview}</aside>}
      <div className="ml-fields">
        {unavailable && <p className="ml-banner" role="status">{ui(unavailableMessage)}</p>}
        <MaterialMetadataFields value={draft} onChange={setDraft} disabled={operating || disabled || unavailable}
          invalidField={invalidField} errorId={`${id}-error`} autoFocus nameFeedback={<>
          {duplicate?.name === normalizedName && duplicate.found &&
            <p className="ml-banner" role="status">{excludeId ?
              ui("已有其他同名素材，修改不会覆盖其他素材。") : ui("已有同名素材，保存后会新增一份，不会覆盖。")}</p>}
          {duplicate?.name === normalizedName && duplicate.failed &&
            <p className="ml-help" role="status">{confirmDuplicateName
              ? ui("暂时无法检查同名素材；点击保存时将重新检查。")
              : ui("暂时无法检查同名素材；修改不会覆盖其他素材。")}</p>}
          </>}>
          {omittedLegacyImages > 0 && <div className="ml-banner">
            <p>{ui("该服装包含")} {omittedLegacyImages} {ui("张隐藏的旧版试穿参考。本次仅保存可见主图库，不包含这些图片。")}</p>
            <label className="ml-check"><input type="checkbox" name="confirm-legacy" checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)} />{ui("我确认仅保存可见主图库")}</label>
          </div>}
        </MaterialMetadataFields>
        <p id={`${id}-error`} className="ml-error" role={error ? "alert" : undefined}>{error}</p>
      </div>
    </div>
    <footer className="ml-footer">
      <p role="status">{checkingName ? ui("正在检查同名素材…") :
        operating ? footerStatus || ui("正在保存，请稍候…") : footerStatus || ui("素材名称与组件内容互相独立。")}</p>
      <div className="ml-actions">
        {extraActions}
        <button type="button" disabled={operating} onClick={onClose}>{disabled ? ui("完成") : ui("取消")}</button>
        {!disabled && <button type="submit" className="ml-primary" disabled={operating || unavailable}>{submitLabel}</button>}
      </div>
    </footer>
  </form>
    {pendingDuplicate && <MaterialDuplicateNameDialog name={pendingDuplicate.name} creating
      onCancel={() => setPendingDuplicate(null)} onConfirm={() => void submit(pendingDuplicate, true)} />}
  </>;
}
