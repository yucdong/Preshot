import { useRef, useState } from "react";
import { useArtifactDraftCommit } from "./ArtifactDraftContext";
import { componentTextInputEvents } from "./componentTextInput";

function MetadataField({
  label, value, multiline = false, onCommit,
}: {
  label: string; value: string; multiline?: boolean; onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const latest = useRef(value);
  const prepare = () => {
    const next = latest.current.trim();
    return () => { if (next !== value) onCommit(next); };
  };
  useArtifactDraftCommit(prepare, () => { latest.current = value; setDraft(value); });
  const change = (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = event.currentTarget.value;
    latest.current = next;
    setDraft(next);
  };
  const shared = {
    ...componentTextInputEvents,
    className: "preshot-component-field w-full rounded border border-paper-border bg-white px-2.5 py-2 text-sm text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-primary",
    value: draft,
    onBlur: () => prepare()(),
    // Capture native input before editor event handling so blur/save see visible text.
    onInputCapture: change,
    onChange: change,
  };
  return <label className="grid gap-1 text-xs font-semibold text-paper-muted">
    <span>{label}</span>
    {multiline ? <textarea {...shared} rows={2} /> : <input {...shared} />}
  </label>;
}

export function ImageGroupMetadataFields({
  name, description, onCommit,
}: {
  name: string; description: string; onCommit(update: { name?: string; description?: string }): void;
}) {
  return <div className="bn-drag-exclude mb-3 grid gap-3">
    <MetadataField key={`name:${name}`} label="图片组名称" value={name} onCommit={(name) => onCommit({ name })} />
    <MetadataField key={`description:${description}`} label="图片组说明" value={description} multiline onCommit={(description) => onCommit({ description })} />
  </div>;
}
