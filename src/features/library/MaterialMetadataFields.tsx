import { useId, type ReactNode } from "react";
import type { MaterialMetadataDraft } from "./materialMetadataDraft";

export function MaterialMetadataFields({
  value, onChange, disabled, invalidField, errorId, nameFeedback, children, autoFocus = false,
}: {
  value: MaterialMetadataDraft;
  onChange(value: MaterialMetadataDraft): void;
  disabled?: boolean;
  invalidField?: string;
  errorId: string;
  nameFeedback?: ReactNode;
  children?: ReactNode;
  autoFocus?: boolean;
}) {
  const id = useId();
  return <fieldset disabled={disabled}>
    <label htmlFor={`${id}-name`}>素材名称 <span aria-hidden="true">*</span></label>
    <input id={`${id}-name`} name="material-name" required value={value.name} autoComplete="off"
      data-library-autofocus={autoFocus ? "" : undefined} aria-describedby={`${id}-name-help ${errorId}`}
      aria-invalid={invalidField === "name" || undefined}
      onChange={(event) => onChange({ ...value, name: event.target.value })} />
    <p id={`${id}-name-help`} className="ml-help">仅用于素材库检索，不修改组件内标题。必填，最多 80 字。</p>
    {nameFeedback}
    <label htmlFor={`${id}-tags`}>标签</label>
    <input id={`${id}-tags`} name="material-tags" value={value.tags}
      onChange={(event) => onChange({ ...value, tags: event.target.value })}
      aria-invalid={invalidField === "tags" || undefined}
      aria-describedby={`${id}-tags-help ${errorId}`} placeholder="例如：夜景，街拍，霓虹" />
    <p id={`${id}-tags-help`} className="ml-help">标签用于关键词检索。用逗号分隔，最多 12 个标签，每个最多 24 字。</p>
    <label htmlFor={`${id}-description`}>素材说明</label>
    <textarea id={`${id}-description`} name="material-description" value={value.description}
      onChange={(event) => onChange({ ...value, description: event.target.value })}
      aria-invalid={invalidField === "description" || undefined}
      aria-describedby={`${id}-description-help ${errorId}`} rows={4} />
    <p id={`${id}-description-help`} className="ml-help">选填，最多 1000 字；不修改组件里的文字。</p>
    <label className="ml-check">
      <input type="checkbox" checked={value.favorite} onChange={(event) => onChange({ ...value, favorite: event.target.checked })} />
      收藏素材
    </label>
    {children}
  </fieldset>;
}
