import { ui, useUiLanguage } from "../../shared/i18n/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { MaterialDetail, MaterialMetadata, MaterialPayload } from "../../domain/library";
import { LibraryDialog } from "./LibraryDialog";
import { MaterialContentCanvas, type MaterialContentCanvasHandle, type MaterialCanvasViewport } from "./MaterialContentCanvas";
import type { MaterialEditLease } from "./materialEditLease";
import { libraryError, materialKindLabels, metadataValidationError, useLibraryLifetime } from "./libraryUi";
import { MaterialMetadataFields } from "./MaterialMetadataFields";
import { createMetadataDraft, readMetadataDraft } from "./materialMetadataDraft";
import { MaterialDuplicateNameDialog } from "./MaterialDuplicateNameDialog";

type Assets = { sessionId: string } & (
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; images: ReadonlyMap<string, string> });

interface SaveDraft {
  payload: MaterialPayload;
  metadata: MaterialMetadata;
  viewport: MaterialCanvasViewport;
}

export function MaterialContentEditor({
  lease, onClose, onSaved, onContinue, checkDuplicateName,
}: {
  lease: MaterialEditLease;
  onClose(saved: MaterialDetail | null): void;
  onSaved(material: MaterialDetail): void;
  onContinue(material: MaterialDetail): Promise<MaterialEditLease | null>;
  checkDuplicateName(name: string, excludeId?: string): Promise<boolean>;
}) {
  useUiLanguage();
  const { material, sessionId } = lease.session;
  const [loadedAssets, setAssets] = useState<Assets>({ sessionId, status: "loading" });
  const assets = loadedAssets.sessionId === sessionId ? loadedAssets : { status: "loading" as const };
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [metadata, setMetadata] = useState(() => createMetadataDraft(material));
  const [metadataError, setMetadataError] = useState("");
  const [invalidField, setInvalidField] = useState<string>();
  const metadataPanel = useRef<HTMLElement>(null);
  const metadataErrorId = useId();
  const composing = useRef(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [saved, setSaved] = useState<MaterialDetail | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<SaveDraft | null>(null);
  const canvas = useRef<MaterialContentCanvasHandle>(null);
  const lock = useRef(false);
  const canvasLock = useRef(false);
  const [viewport, setViewport] = useState<MaterialCanvasViewport>();
  const alive = useLibraryLifetime();
  const uncertain = lease.isUncertain;
  const busy = Boolean(operation) || canvasBusy;
  const editingDisabled = busy || uncertain || Boolean(lease.savedMaterial) || lease.isRetired;
  const changeBusy = useCallback((value: boolean) => {
    canvasLock.current = value;
    setCanvasBusy(value);
  }, []);
  const changeDraft = useCallback(() => { setDirty(true); setError(""); }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const images = new Map<string, string>();
        for (const image of material.images) {
          const src = await lease.repository.loadEditImage(sessionId, image.localImageId);
          if (!active) return;
          images.set(image.localImageId, src);
        }
        if (active) setAssets({ sessionId, status: "ready", images });
      } catch (failure) {
        if (active) setAssets({ sessionId, status: "error", message: libraryError(failure, ui("无法加载素材原图")) });
      }
    })();
    return () => { active = false; };
  }, [lease, material, sessionId, loadAttempt]);

  const continueSaved = async (result: MaterialDetail) => {
    if (alive.current) setOperation(ui("素材已保存，正在准备继续编辑…"));
    try {
      if (await lease.retire() === "retained") throw new Error(ui("保存结果尚未确认，不能开始新的编辑"));
      if (!alive.current) return;
      const next = await onContinue(result);
      if (alive.current && next) {
        setMetadata(createMetadataDraft(next.session.material));
        setResumeError("");
        setCleanupError("");
      }
    } catch (failure) {
      if (alive.current) setResumeError(libraryError(failure, ui("素材已保存，但暂时无法继续编辑；可重试或关闭")));
    }
  };

  const save = async (confirmed?: SaveDraft) => {
    if (lock.current || canvasLock.current || composing.current || lease.isRetired ||
        (pendingDuplicate && !confirmed) || assets.status !== "ready" ||
        (!dirty && !uncertain && !lease.session.isNew)) return;
    lock.current = true;
    setError("");
    let checkingName = false;
    try {
      if (!canvas.current) throw new Error(ui("素材画布尚未准备好"));
      let draft = confirmed;
      if (!uncertain && !draft) {
        let validatedMetadata: MaterialMetadata;
        try {
          validatedMetadata = readMetadataDraft(metadata);
          setMetadataError("");
          setInvalidField(undefined);
        } catch (failure) {
          const validation = metadataValidationError(failure);
          setMetadataError(validation.message);
          setInvalidField(validation.field);
          metadataPanel.current?.querySelector<HTMLElement>(`[name="material-${validation.field}"]`)?.focus();
          return;
        }
        draft = structuredClone({
          payload: canvas.current.readPayload(), metadata: validatedMetadata,
          viewport: canvas.current.readViewport(),
        });
        checkingName = true;
        setOperation(ui("正在检查同名素材…"));
        const duplicate = await checkDuplicateName(draft.metadata.name, lease.session.isNew ? undefined : material.id);
        checkingName = false;
        if (!alive.current || lease.isRetired) return;
        if (duplicate) {
          setPendingDuplicate(draft);
          return;
        }
      }
      setPendingDuplicate(null);
      if (draft) setViewport(draft.viewport);
      setOperation(uncertain ? ui("正在确认上一次保存结果…") : ui("正在保存素材…"));
      const result = draft ? await lease.save(draft.payload, draft.metadata) : await lease.retrySave();
      if (!alive.current) return;
      setSaved(result);
      setDirty(false);
      onSaved(result);
      if (lease.session.isNew) {
        setOperation(ui("正在关闭编辑画布…"));
        try {
          if (await lease.retire() === "retained") throw new Error(ui("保存结果尚未确认，草稿已保留，请重试确认"));
          if (alive.current) onClose(result);
        } catch (failure) {
          if (alive.current) setCleanupError(libraryError(failure, ui("素材已保存，但草稿清理失败")));
        }
      } else {
        await continueSaved(result);
      }
    } catch (failure) {
      if (alive.current) setError(libraryError(failure, checkingName ? ui("无法检查同名素材，请重试") :
        lease.isUncertain ? ui("保存结果尚未确认，请重试确认") : ui("无法保存素材")));
    } finally {
      lock.current = false;
      if (alive.current) setOperation("");
    }
  };

  const cancel = async () => {
    if (lock.current || canvasLock.current || lease.isUncertain) return;
    lock.current = true;
    setConfirmDiscard(false);
    setOperation(saved ? ui("正在关闭编辑画布…") : ui("正在取消并清理草稿…"));
    try {
      const result = await lease.retire();
      if (result === "retained") throw new Error(ui("保存结果尚未确认，草稿已保留，请重试确认"));
      if (alive.current) onClose(saved);
    } catch (failure) {
      if (alive.current) setCleanupError(libraryError(failure, saved ? ui("素材已保存，但草稿清理失败") : ui("无法清理草稿，请重试取消")));
    } finally {
      lock.current = false;
      if (alive.current) setOperation("");
    }
  };
  const requestClose = () => {
    if (lock.current || canvasLock.current || uncertain) return;
    if (dirty && !lease.isRetired) setConfirmDiscard(true);
    else void cancel();
  };
  const retryContinuing = async () => {
    if (!saved || lock.current) return;
    lock.current = true;
    try { await continueSaved(saved); }
    finally {
      lock.current = false;
      if (alive.current) setOperation("");
    }
  };

  return <>
    <LibraryDialog title={lease.session.isNew && !saved ? ui("创建素材") : ui("编辑素材")}
      subtitle={lease.session.isNew && !saved ? materialKindLabels[material.kind] :
        `${saved?.name ?? material.name} · ${materialKindLabels[material.kind]}`}
      className="ml-content-editor-dialog" busy={busy || uncertain} onClose={requestClose}
      onKeyDown={(event) => {
        if (!(event.target instanceof Element) ||
            event.target.closest('[role="dialog"]') !== event.currentTarget) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (!busy) void save();
        }
      }}>
      <div className="ml-content-scope">
        <span><LockKeyhole size={15} aria-hidden="true" />{ui("仅编辑当前素材")}</span>
        <p>{ui("素材信息与画布内容一起保存；不能插入、删除或替换整块组件。已有项目副本不受影响。")}</p>
        <span className="ml-content-dirty" role="status">{dirty ? ui("未保存修改") : saved ? ui("已保存") : ui("独立草稿")}</span>
      </div>
      <div className="ml-content-editor-body"
        onCompositionStartCapture={() => { composing.current = true; }}
        onCompositionEndCapture={() => { composing.current = false; }}>
        <aside className="ml-material-metadata ml-fields" ref={metadataPanel} aria-label={ui("素材信息")}>
          <h3>{ui("素材信息")}</h3>
          <MaterialMetadataFields value={metadata} disabled={editingDisabled}
            invalidField={invalidField} errorId={metadataErrorId} autoFocus
            onChange={(value) => {
              setMetadata(value);
              setMetadataError("");
              setInvalidField(undefined);
              changeDraft();
            }} />
          <p id={metadataErrorId} className="ml-error" role={metadataError ? "alert" : undefined}>{metadataError}</p>
        </aside>
        <div className="ml-material-canvas-pane"
          onInputCapture={(event) => {
            const field = event.target;
            if (!editingDisabled && field instanceof HTMLElement &&
                (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type !== "range")) &&
                field.closest('[role="dialog"]')?.classList.contains("ml-content-editor-dialog")) {
              setDirty(true);
            }
          }}>
          {assets.status === "loading" && <div className="ml-content-loading" role="status">{ui("正在准备独立画布和原始图片…")}</div>}
          {assets.status === "error" && <div className="ml-content-loading">
            <p className="ml-error" role="alert">{assets.message}</p>
            <button type="button" disabled={busy || lease.isRetired} onClick={() => {
              setAssets({ sessionId, status: "loading" }); setLoadAttempt((value) => value + 1);
            }}>{ui("重新加载原图")}</button>
          </div>}
          {assets.status === "ready" && <MaterialContentCanvas ref={canvas}
            material={material} assets={assets.images} sessionId={sessionId}
            repository={lease.repository} disabled={editingDisabled}
            initialViewport={viewport}
            onChange={changeDraft} onBusyChange={changeBusy} onError={setError} />}
        </div>
      </div>
      <footer className="ml-footer ml-content-editor-footer">
        <div>
          <p role="status">{operation || (saved && !dirty ? lease.session.isNew ? ui("已保存") : ui("素材已保存，可继续编辑；关闭后更新预览。") : ui("素材信息和画布内容一起保存。Ctrl+S 保存。"))}</p>
          {uncertain && <p className="ml-error" role="alert">{ui("暂时不能继续编辑或取消，以免误判保存结果。重试会确认同一次保存，不会重复保存。")}</p>}
          {[error, cleanupError, resumeError].filter(Boolean).map((message) =>
            <p className="ml-error" role="alert" key={message}>{message}</p>)}
        </div>
        <div className="ml-actions">
          <button type="button" disabled={busy || uncertain} onClick={requestClose}>
            {saved ? ui("关闭") : cleanupError ? ui("重试取消") : ui("取消")}
          </button>
          {resumeError ? <button type="button" className="ml-primary" disabled={busy}
            onClick={() => void retryContinuing()}>{ui("重试继续编辑")}</button> :
            <button type="button" className="ml-primary"
              disabled={busy || assets.status !== "ready" || lease.isRetired || (!dirty && !uncertain && !lease.session.isNew)}
              onClick={() => void save()}>{uncertain ? ui("重试确认保存") : ui("保存素材")}</button>}
        </div>
      </footer>
    </LibraryDialog>
    {pendingDuplicate && <MaterialDuplicateNameDialog name={pendingDuplicate.metadata.name}
      creating={lease.session.isNew === true} onCancel={() => setPendingDuplicate(null)}
      onConfirm={() => void save(pendingDuplicate)} />}
    {confirmDiscard && <LibraryDialog title={ui("放弃素材修改？")} className="ml-confirm-dialog"
      onClose={() => setConfirmDiscard(false)}>
      <div className="ml-confirm-body"><p>{ui("只放弃尚未保存的素材信息、文字和图片修改，已保存的素材和已有项目不会改变。")}</p></div>
      <footer className="ml-footer"><div className="ml-actions">
        <button type="button" data-library-autofocus="" onClick={() => setConfirmDiscard(false)}>{ui("继续编辑")}</button>
        <button type="button" className="ml-danger" onClick={() => void cancel()}>{ui("放弃修改")}</button>
      </div></footer>
    </LibraryDialog>}
  </>;
}
