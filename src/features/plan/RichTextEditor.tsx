import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useRef } from "react";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
}

export function RichTextEditor({ html, onChange, ariaLabel, placeholder, compact }: RichTextEditorProps) {
  const editor = useCreateBlockNote();
  const lastHtmlRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (html === lastHtmlRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const blocks = await Promise.resolve(editor.tryParseHTMLToBlocks(html && html.trim() ? html : "<p></p>"));
      if (cancelled) {
        return;
      }
      editor.replaceBlocks(editor.document, blocks);
      lastHtmlRef.current = html;
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, html]);

  const handleChange = async () => {
    const next = await Promise.resolve(editor.blocksToHTMLLossy(editor.document));
    lastHtmlRef.current = next;
    onChangeRef.current(next);
  };

  return (
    <div aria-label={ariaLabel} className={`bn-wrap${compact ? " bn-compact" : ""}`} data-placeholder={placeholder} role="group">
      <BlockNoteView editor={editor} onChange={handleChange} sideMenu={!compact} theme="light" />
    </div>
  );
}
