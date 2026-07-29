import Link from "@tiptap/extension-link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
}

const toolbarButton =
  "rounded px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100 aria-pressed:bg-stone-900 aria-pressed:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

function ToolbarButton({
  editor,
  label,
  isActive,
  onClick,
}: {
  editor: Editor;
  label: string;
  isActive: boolean;
  onClick(): void;
}) {
  void editor;
  return (
    <button aria-label={label} aria-pressed={isActive} className={toolbarButton} onClick={onClick} type="button">
      {label}
    </button>
  );
}

export function RichTextEditor({ html, onChange, ariaLabel, placeholder }: RichTextEditorProps) {
  const [, forceUpdate] = useState(0);
  
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] }, link: false }),
      Link.configure({ openOnClick: false }),
    ],
    content: html,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    onTransaction: () => forceUpdate((n) => n + 1),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        role: "textbox",
        class:
          "prose prose-sm max-w-none min-h-[6rem] rounded-lg border border-black/10 px-3 py-2 text-sm text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
      },
    },
  });

  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, html]);

  if (!editor) {
    return null;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        <ToolbarButton editor={editor} isActive={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("heading", { level: 1 })} label="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("heading", { level: 2 })} label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("bulletList")} label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton editor={editor} isActive={editor.isActive("orderedList")} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton
          editor={editor}
          isActive={editor.isActive("link")}
          label="Link"
          onClick={() => {
            const previous = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("Link URL", previous ?? "https://");
            if (url === null) return;
            if (url === "") {
              editor.chain().focus().unsetLink().run();
              return;
            }
            editor.chain().focus().setLink({ href: url }).run();
          }}
        />
      </div>
      <EditorContent editor={editor} placeholder={placeholder} />
    </div>
  );
}
