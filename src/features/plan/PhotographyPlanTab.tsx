import { RichTextEditor } from "./RichTextEditor";

interface PhotographyPlanTabProps {
  html: string;
  onChange(html: string): void;
}

export function PhotographyPlanTab({ html, onChange }: PhotographyPlanTabProps) {
  return (
    <section aria-label="Photography Plan" className="border-b border-black/10 bg-white/60 px-6 py-5">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-amber-700">Photography Plan</p>
      <h3 className="mt-2 mb-3 text-xl font-semibold text-stone-900">Shot notes</h3>
      <RichTextEditor ariaLabel="Photography plan" html={html} onChange={onChange} placeholder="Shot list, schedule, and notes…" />
    </section>
  );
}
