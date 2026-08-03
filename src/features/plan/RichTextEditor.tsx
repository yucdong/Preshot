import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { zh } from "@blocknote/core/locales";
import { useEffect, useRef } from "react";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
}

export function RichTextEditor({ html, onChange, ariaLabel, placeholder, compact }: RichTextEditorProps) {
  const editor = useCreateBlockNote({ dictionary: zh });
  const lastEmitRef = useRef<string | null>(null);
  const lastPropHtmlRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (html === lastPropHtmlRef.current) {
      return;
    }
    lastPropHtmlRef.current = html;
    let cancelled = false;
    void (async () => {
      try {
        const blocks = await Promise.resolve(editor.tryParseHTMLToBlocks(html && html.trim() ? html : "<p></p>"));
        if (cancelled) {
          return;
        }
        editor.replaceBlocks(editor.document, blocks);
        // Record the serialization of the just-loaded document as the emit baseline,
        // synchronously relative to replaceBlocks. replaceBlocks makes BlockNote fire
        // onChange, but handleChange only compares after awaiting blocksToHTMLLossy, so
        // this synchronous assignment always wins the race and the hydration echo is
        // suppressed. blocksToHTMLLossy is synchronous in BlockNote 0.52; awaiting it
        // here would defer the assignment past the queued echo and reintroduce the race.
        lastEmitRef.current = editor.blocksToHTMLLossy(editor.document);
      } catch (error) {
        console.error("RichTextEditor failed to load HTML content", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, html]);

  const handleChange = async () => {
    try {
      const next = await Promise.resolve(editor.blocksToHTMLLossy(editor.document));
      if (next === lastEmitRef.current) {
        return;
      }
      lastEmitRef.current = next;
      lastPropHtmlRef.current = next;
      onChangeRef.current(next);
    } catch (error) {
      console.error("RichTextEditor failed to serialize content", error);
    }
  };

  return (
    <div aria-label={ariaLabel} className={`bn-wrap${compact ? " bn-compact" : ""}`} data-placeholder={placeholder} role="group">
      <BlockNoteView editor={editor} onChange={handleChange} sideMenu={!compact} theme="light" />
    </div>
  );
}
