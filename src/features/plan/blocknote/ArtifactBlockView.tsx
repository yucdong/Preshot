import {
  ContactRound,
  Copy,
  Library,
  MapPin,
  MoreHorizontal,
  PackageOpen,
  Shirt,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useId,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type {
  ArtifactRecord,
  ClothingArtifact,
  ImageCollection,
  ModelCardArtifact,
  PropArtifact,
  ShootingLocationArtifact,
} from "../../../domain/plan/canvas/blockDocument";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import {
  useArtifactBlockReader,
  useOptionalArtifactBlockController,
} from "./ArtifactBlockContext";
import { ImageGroupBlockRenderer } from "./ImageGroupBlockRenderer";
import { ArtifactDraftValidationError, useArtifactDraftCommit } from "./ArtifactDraftContext";
import { componentTextInputEvents } from "./componentTextInput";
import { useOptionalImageGroupExportController } from "./export/ImageGroupExportContext";

interface ArtifactMeta {
  icon: LucideIcon;
  label: string;
}

const ARTIFACT_META: Record<ArtifactRecord["kind"], ArtifactMeta> = {
  shootingLocation: { icon: MapPin, label: "拍摄场地" },
  modelCard: { icon: ContactRound, label: "模特信息" },
  clothing: { icon: Shirt, label: "服装" },
  prop: { icon: PackageOpen, label: "道具" },
};

interface CommittedTextFieldProps {
  balanced?: boolean;
  label: string;
  multiline?: boolean;
  onCommit(value: string): void;
  placeholder?: string;
  required?: boolean;
  value: string;
}

function CommittedTextField(props: CommittedTextFieldProps) {
  return <CommittedTextFieldDraft key={props.value} {...props} />;
}

function CommittedTextFieldDraft({
  balanced = false,
  label,
  multiline = false,
  onCommit,
  placeholder,
  required = false,
  value,
}: CommittedTextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [error, setError] = useState(false);

  const prepareCommit = () => {
    const normalized = draftRef.current.trim();
    if (required && !normalized) {
      setError(true);
      return null;
    }
    setError(false);
    return () => { if (normalized !== value) onCommit(normalized); };
  };
  useArtifactDraftCommit(() => {
    const commit = prepareCommit();
    if (!commit) throw new ArtifactDraftValidationError(`请输入${label}后再保存。`);
    return commit;
  }, () => { draftRef.current = value; setDraft(value); setError(false); });
  const commit = () => prepareCommit()?.();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape" && draft !== value) {
      event.preventDefault();
      draftRef.current = value;
      setDraft(value);
      setError(false);
    }
  };
  const className =
    "preshot-component-field w-full rounded border border-paper-border bg-white px-2.5 py-2 text-sm text-paper-ink shadow-sm transition-colors focus-visible:border-paper-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary/25";
  const change = (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    draftRef.current = event.currentTarget.value;
    setDraft(event.currentTarget.value);
  };

  return (
    <label className={`grid min-w-0 gap-1 text-xs font-semibold text-paper-muted ${
      balanced ? "preshot-balanced-info-field" : ""
    }`}>
      <span>{label}{required ? <span aria-hidden> *</span> : null}</span>
      {multiline ? (
        <textarea
          {...componentTextInputEvents}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error}
          className={`${className} leading-5 ${
            balanced
              ? "preshot-balanced-info-textarea"
              : "min-h-20 resize-y"
          }`}
          onBlur={commit}
          onInputCapture={change}
          onChange={change}
          placeholder={placeholder}
          value={draft}
        />
      ) : (
        <input
          {...componentTextInputEvents}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error}
          className={className}
          onBlur={commit}
          onInputCapture={change}
          onChange={change}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          value={draft}
        />
      )}
      {error ? (
        <span className="font-medium text-paper-danger" id={errorId}>
          请输入{label}
        </span>
      ) : null}
    </label>
  );
}

interface CommittedTitleFieldProps {
  label: string;
  onCommit(value: string): void;
  value: string;
}

function CommittedTitleField(props: CommittedTitleFieldProps) {
  return <CommittedTitleFieldDraft key={props.value} {...props} />;
}

function CommittedTitleFieldDraft({
  label,
  onCommit,
  value,
}: CommittedTitleFieldProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const [error, setError] = useState(false);
  const prepareCommit = () => {
    const normalized = draftRef.current.trim();
    if (!normalized) {
      setError(true);
      return null;
    }
    setError(false);
    return () => { if (normalized !== value) onCommit(normalized); };
  };
  useArtifactDraftCommit(() => {
    const commit = prepareCommit();
    if (!commit) throw new ArtifactDraftValidationError(`请输入${label}后再保存。`);
    return commit;
  }, () => { draftRef.current = value; setDraft(value); setError(false); });
  const change = (event: React.SyntheticEvent<HTMLInputElement>) => {
    draftRef.current = event.currentTarget.value;
    setDraft(event.currentTarget.value);
  };
  return (
    <>
      <input
        {...componentTextInputEvents}
        aria-invalid={error}
        aria-label={label}
        className="preshot-component-field w-full min-w-0 border-0 border-b border-transparent bg-transparent p-0 pb-0.5 text-base font-bold text-paper-ink outline-none transition-colors hover:border-paper-border focus:border-paper-primary focus:ring-0"
        onBlur={() => prepareCommit()?.()}
        onInputCapture={change}
        onChange={change}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape" && draft !== value) {
            event.preventDefault();
            draftRef.current = value;
            setDraft(value);
            setError(false);
          }
        }}
        value={draft}
      />
      {error ? (
        <span className="text-[10px] font-semibold text-paper-danger" role="alert">
          请输入{label}
        </span>
      ) : null}
    </>
  );
}

interface CommittedNumberFieldProps {
  label: string;
  max: number;
  min: number;
  onCommit(value: number | null): void;
  suffix: string;
  value: number | null;
}

function CommittedNumberField(props: CommittedNumberFieldProps) {
  return (
    <CommittedNumberFieldDraft
      key={props.value === null ? "empty" : props.value}
      {...props}
    />
  );
}

function CommittedNumberFieldDraft({
  label,
  max,
  min,
  onCommit,
  suffix,
  value,
}: CommittedNumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const draftRef = useRef(value === null ? "" : String(value));
  const [error, setError] = useState(false);
  const prepareCommit = () => {
    const normalized = draftRef.current.trim();
    if (!normalized) {
      setError(false);
      return () => { if (value !== null) onCommit(null); };
    }

    const number = Number(normalized);
    if (!Number.isFinite(number) || number < min || number > max) {
      setError(true);
      return null;
    }
    setError(false);
    return () => { if (number !== value) onCommit(number); };
  };
  useArtifactDraftCommit(() => {
    const commit = prepareCommit();
    if (!commit) throw new ArtifactDraftValidationError(`${label}应为 ${min}–${max} ${suffix}，请修正后再保存。`);
    return commit;
  }, () => {
    const restored = value === null ? "" : String(value);
    draftRef.current = restored; setDraft(restored); setError(false);
  });
  const change = (event: React.SyntheticEvent<HTMLInputElement>) => {
    draftRef.current = event.currentTarget.value;
    setDraft(event.currentTarget.value);
  };
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-paper-muted">
      <span>{label}</span>
      <span className="flex overflow-hidden rounded border border-paper-border bg-white shadow-sm focus-within:border-paper-primary focus-within:ring-2 focus-within:ring-paper-primary/25">
        <input
          {...componentTextInputEvents}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error}
          className="preshot-component-field min-w-0 flex-1 px-2.5 py-2 text-sm text-paper-ink outline-none"
          inputMode="decimal"
          onBlur={() => prepareCommit()?.()}
          onInputCapture={change}
          onChange={change}
          value={draft}
        />
        <span className="grid min-w-10 place-items-center border-l border-paper-border bg-paper-subtle px-2 text-[11px]">
          {suffix}
        </span>
      </span>
      {error ? (
        <span className="font-medium text-paper-danger" id={`${id}-error`}>
          {label}应为 {min}–{max} {suffix}
        </span>
      ) : null}
    </label>
  );
}

function ReadonlyValue({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  if (value === "" || value === null) return null;
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11px] font-semibold text-paper-muted">{label}</dt>
      <dd className="m-0 whitespace-pre-wrap text-sm text-paper-ink">{value}</dd>
    </div>
  );
}

function ArtifactGallery({
  autoCompact = false,
  balanced = false,
  blockId,
  collection,
  label,
}: {
  autoCompact?: boolean;
  balanced?: boolean;
  blockId: string;
  collection: ImageCollection;
  label: string;
}) {
  const exporting = useOptionalImageGroupExportController() !== null;
  return (
    <section
      className={`grid gap-2 ${
        balanced ? "preshot-balanced-gallery" : ""
      } ${exporting ? "" : "preshot-editable-gallery"}`}
      aria-label={label}
    >
      {exporting && <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-bold text-paper-ink">{label}</h3>
        <span className="text-[11px] font-semibold text-paper-muted">
          {collection.images.length} 张图片
        </span>
      </div>}
      <ImageGroupBlockRenderer
        autoCompact={autoCompact}
        blockId={`${blockId}:${collection.id}`}
        groupId={collection.id}
        label={label}
        variant="embedded"
      />
    </section>
  );
}

function locationInfo(artifact: ShootingLocationArtifact): string {
  return [artifact.address, artifact.description]
    .filter((value) => value.trim())
    .join("\n");
}

function locationFromInfo(
  artifact: ShootingLocationArtifact,
  value: string,
): ShootingLocationArtifact {
  const [address = "", ...description] = value
    .split("\n")
    .map((line) => line.trim());
  return {
    ...artifact,
    address,
    description: description.filter(Boolean).join("\n"),
  };
}

function propInfo(artifact: PropArtifact): string {
  return artifact.source;
}

function propFromInfo(
  artifact: PropArtifact,
  value: string,
): PropArtifact {
  return {
    ...artifact,
    source: value.trim(),
  };
}

function ArtifactMenu({
  blockId,
  title,
}: {
  blockId: string;
  title: string;
}) {
  const controller = useOptionalArtifactBlockController();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);
  if (!controller?.removeArtifactBlock || controller.structureEditable === false) return null;
  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`${title}更多操作`}
          className="grid h-8 w-8 place-items-center rounded text-paper-muted hover:bg-paper-subtle hover:text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary"
          onClick={() => setOpen((value) => !value)}
          ref={triggerRef}
          type="button"
        >
          <MoreHorizontal aria-hidden size={18} />
        </button>
        {open ? (
          <div
            className="absolute right-0 top-9 z-50 grid w-36 gap-1 rounded border border-paper-border bg-white p-1 shadow-xl"
            role="menu"
          >
            {controller.saveArtifactBlock ? (
              <button
                className="flex min-h-9 items-center gap-2 rounded px-2 text-left text-xs font-semibold hover:bg-paper-subtle"
                onClick={() => {
                  setOpen(false);
                  controller.saveArtifactBlock?.(blockId);
                }}
                role="menuitem"
                type="button"
              >
                <Library aria-hidden size={15} />保存到素材库
              </button>
            ) : null}
            <button
              className="flex min-h-9 items-center gap-2 rounded px-2 text-left text-xs font-semibold hover:bg-paper-subtle"
              onClick={() => {
                setOpen(false);
                controller.duplicateArtifactBlock?.(blockId);
              }}
              role="menuitem"
              type="button"
            >
              <Copy aria-hidden size={15} />复制组件
            </button>
            <button
              className="flex min-h-9 items-center gap-2 rounded px-2 text-left text-xs font-semibold text-paper-danger hover:bg-paper-danger-soft"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
              role="menuitem"
              type="button"
            >
              <Trash2 aria-hidden size={15} />删除组件
            </button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel="删除"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          controller.removeArtifactBlock?.(blockId);
        }}
        open={confirming}
        title={`删除“${title}”？`}
      />
    </>
  );
}

function EditableArtifact({
  artifact,
  blockId,
  kindLabel,
  update,
}: {
  artifact: ArtifactRecord;
  blockId: string;
  kindLabel?: string;
  update(next: ArtifactRecord): void;
}) {
  if (artifact.kind === "shootingLocation") {
    const location = artifact as ShootingLocationArtifact;
    return (
      <div className="preshot-artifact-balanced-layout">
        <div className="grid min-h-0">
          <CommittedTextField
            balanced
            label="场地信息"
            multiline
            onCommit={(value) => update(locationFromInfo(location, value))}
            placeholder={"填写地址、入场时间、光线条件和其他说明"}
            value={locationInfo(location)}
          />
        </div>
        <ArtifactGallery
          balanced
          blockId={blockId}
          collection={location.gallery}
          label="场地图片"
        />
      </div>
    );
  }
  if (artifact.kind === "modelCard") {
    const model = artifact as ModelCardArtifact;
    return (
      <div className="preshot-artifact-balanced-layout">
        <fieldset
          aria-label="模特信息"
          className="preshot-balanced-model-info m-0 min-w-0 border-0 p-0"
        >
          <div className="flex min-h-8 items-start">
            <span className="text-xs font-semibold text-paper-muted">
              模特信息
            </span>
          </div>
          <div className="preshot-balanced-model-fields">
            <CommittedTextField label="模特名称 / 编号" onCommit={(modelId) => update({ ...model, modelId })} required value={model.modelId} />
            <CommittedNumberField label="身高" min={50} max={250} onCommit={(heightCm) => update({ ...model, heightCm })} suffix="cm" value={model.heightCm} />
            <CommittedNumberField label="体重" min={10} max={300} onCommit={(weightKg) => update({ ...model, weightKg })} suffix="kg" value={model.weightKg} />
            <CommittedTextField label="鞋码" onCommit={(shoeSize) => update({ ...model, shoeSize })} value={model.shoeSize} />
            <div className="preshot-balanced-model-notes">
              <CommittedTextField
                label="其他信息"
                multiline
                onCommit={(notes) => update({ ...model, notes })}
                placeholder="填写风格偏好、档期、妆发或其他说明"
                value={model.notes ?? ""}
              />
            </div>
          </div>
        </fieldset>
        <ArtifactGallery
          balanced
          blockId={blockId}
          collection={model.samples}
          label="样片"
        />
      </div>
    );
  }
  if (artifact.kind === "clothing") {
    const clothing = artifact as ClothingArtifact;
    return (
      <div className="preshot-artifact-balanced-layout">
          <div className="grid min-h-0">
            <CommittedTextField
              balanced
              label={`${kindLabel ?? "服装"}信息`}
              multiline
              onCommit={(source) => update({ ...clothing, source })}
              placeholder="填写品牌、链接、借样、购买和其他说明"
              value={clothing.source}
            />
          </div>
          <ArtifactGallery
            balanced
            blockId={blockId}
            collection={clothing.mainGallery}
            label={`${kindLabel ?? "服装"}图片`}
          />
      </div>
    );
  }
  const prop = artifact as PropArtifact;
  return (
    <div className="preshot-artifact-balanced-layout">
      <div className="grid min-h-0">
        <CommittedTextField
          balanced
          label={`${kindLabel ?? "道具"}信息`}
          multiline
          onCommit={(value) => update(propFromInfo(prop, value))}
          placeholder="填写描述、来源、租赁和其他说明"
          value={propInfo(prop)}
        />
      </div>
      <ArtifactGallery
        balanced
        blockId={blockId}
        collection={prop.gallery}
        label={`${kindLabel ?? "道具"}图片`}
      />
    </div>
  );
}

function ReadonlyArtifact({
  artifact,
  blockId,
  kindLabel,
}: {
  artifact: ArtifactRecord;
  blockId: string;
  kindLabel?: string;
}) {
  if (artifact.kind === "shootingLocation") {
    return (
      <div className="preshot-artifact-balanced-layout">
        <dl className="preshot-balanced-info-readonly grid content-start gap-3">
          <ReadonlyValue label="场地信息" value={locationInfo(artifact)} />
        </dl>
        <ArtifactGallery
          balanced
          blockId={blockId}
          collection={artifact.gallery}
          label="场地图片"
        />
      </div>
    );
  }
  if (artifact.kind === "modelCard") {
    return (
      <div className="preshot-artifact-balanced-layout">
        <section
          aria-label="模特信息"
          className="preshot-balanced-model-info min-w-0"
        >
          <div className="flex min-h-8 items-start">
            <h3 className="m-0 text-sm font-bold text-paper-ink">模特信息</h3>
          </div>
          <dl className="preshot-balanced-model-fields m-0">
            <ReadonlyValue label="模特名称 / 编号" value={artifact.modelId} />
            <ReadonlyValue label="身高" value={artifact.heightCm === null ? null : `${artifact.heightCm} cm`} />
            <ReadonlyValue label="体重" value={artifact.weightKg === null ? null : `${artifact.weightKg} kg`} />
            <ReadonlyValue label="鞋码" value={artifact.shoeSize} />
            <div className="preshot-balanced-model-notes">
              <ReadonlyValue label="其他信息" value={artifact.notes ?? ""} />
            </div>
          </dl>
        </section>
        <ArtifactGallery
          balanced
          blockId={blockId}
          collection={artifact.samples}
          label="样片"
        />
      </div>
    );
  }
  if (artifact.kind === "clothing") {
    return (
      <div className="preshot-artifact-balanced-layout">
          <dl className="preshot-balanced-info-readonly grid content-start gap-3">
            <ReadonlyValue label={`${kindLabel ?? "服装"}信息`} value={artifact.source} />
          </dl>
          <ArtifactGallery
            balanced
            blockId={blockId}
            collection={artifact.mainGallery}
            label={`${kindLabel ?? "服装"}图片`}
          />
      </div>
    );
  }
  return (
    <div className="preshot-artifact-balanced-layout">
      <dl className="preshot-balanced-info-readonly grid content-start gap-3">
        <ReadonlyValue label={`${kindLabel ?? "道具"}信息`} value={propInfo(artifact)} />
      </dl>
      <ArtifactGallery
        balanced
        blockId={blockId}
        collection={artifact.gallery}
        label={`${kindLabel ?? "道具"}图片`}
      />
    </div>
  );
}

function artifactTitle(artifact: ArtifactRecord): string {
  if (artifact.kind === "shootingLocation") return artifact.venueName;
  if (artifact.kind === "modelCard") return artifact.modelId;
  return artifact.title;
}

function artifactTitleLabel(
  artifact: ArtifactRecord,
): "场地名称" | "服装名称" | "道具名称" | null {
  if (artifact.kind === "shootingLocation") return "场地名称";
  if (artifact.kind === "clothing") return "服装名称";
  if (artifact.kind === "prop") return "道具名称";
  return null;
}

export function ArtifactBlockView({
  artifactId,
  blockId,
  expectedKind,
}: {
  artifactId: string;
  blockId: string;
  expectedKind: ArtifactRecord["kind"];
}) {
  const reader = useArtifactBlockReader();
  const controller = useOptionalArtifactBlockController();
  const artifact = useSyncExternalStore(
    reader.subscribe,
    () => reader.getArtifact(artifactId),
    () => reader.getArtifact(artifactId),
  );

  if (!artifact || artifact.kind !== expectedKind) {
    return (
      <div
        className="bn-drag-exclude rounded border border-paper-danger bg-paper-danger-soft p-3 text-xs text-paper-danger"
        contentEditable={false}
        role="alert"
      >
        素材组件数据缺失：{artifactId}
      </div>
    );
  }

  const kindLabel = reader.kindLabels?.[artifact.kind];
  const meta = { ...ARTIFACT_META[artifact.kind], ...(kindLabel ? { label: kindLabel } : {}) };
  const Icon = meta.icon;
  const editable = controller !== null && "updateArtifact" in controller;
  const title = artifactTitle(artifact);
  const titleLabel = kindLabel ? `${kindLabel}名称` : artifactTitleLabel(artifact);
  return (
    <section
      className="preshot-artifact-block bn-drag-exclude relative my-3 grid min-w-0 content-start gap-4 rounded border border-paper-border bg-white p-4 text-paper-ink shadow-sm"
      contentEditable={false}
      data-artifact-id={artifactId}
      data-artifact-kind={artifact.kind}
      data-clipboard-component={editable ? (artifact.kind === "modelCard" ? artifact.samples.id :
        artifact.kind === "clothing" ? artifact.mainGallery.id : artifact.gallery.id) : undefined}
      data-clipboard-component-label={editable ? meta.label : undefined}
      tabIndex={editable ? 0 : undefined}
      role="group"
      aria-label={`${meta.label}组件`}
      aria-description={editable ? "选中后，Ctrl+V 将图片粘贴到该组件的图片区域。" : undefined}
      style={{ width: "100%" }}
    >
      <header className="flex min-w-0 items-center gap-3 border-b border-paper-border pb-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-paper-primary-soft text-paper-primary"
          title={editable ? "选中组件，Ctrl+V 粘贴图片" : undefined}>
          <Icon aria-hidden size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.08em] text-paper-muted">
            {titleLabel
              ? `${meta.label} · ${titleLabel}`
              : meta.label}
          </p>
          {editable && titleLabel ? (
            <CommittedTitleField
              label={titleLabel}
              onCommit={(nextTitle) =>
                controller.updateArtifact(artifactId, (current) =>
                  current.kind === "shootingLocation"
                    ? { ...current, venueName: nextTitle }
                    : current.kind === "clothing" ||
                        current.kind === "prop"
                      ? { ...current, title: nextTitle }
                    : current)}
              value={title}
            />
          ) : (
            <h2 className="m-0 truncate text-base font-bold text-paper-ink">
              {title}
            </h2>
          )}
        </div>
        {editable ? <ArtifactMenu blockId={blockId} title={title} /> : null}
      </header>
      <div className="grid min-w-0 gap-4">
        {editable ? (
          <EditableArtifact
            artifact={artifact}
            blockId={blockId}
            kindLabel={kindLabel}
            update={(next) => controller.updateArtifact(artifactId, (current) => {
              // Several focused-field drafts may flush before React rerenders.
              // Apply only this field's changes, not the old rendered sidecar.
              const changes = Object.fromEntries(Object.entries(next).filter(
                ([key, value]) => value !== artifact[key as keyof ArtifactRecord],
              ));
              return { ...current, ...changes };
            })}
          />
        ) : (
          <ReadonlyArtifact artifact={artifact} blockId={blockId} kindLabel={kindLabel} />
        )}
      </div>
    </section>
  );
}
