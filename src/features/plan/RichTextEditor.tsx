import Color from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import { FontSize } from "./fontSize";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
}

const toolbarButton =
  "rounded px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100 aria-pressed:bg-stone-900 aria-pressed:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500";

const FONT_SIZES = ["12px", "14px", "16px", "18px", "24px", "32px"];

function ToolbarButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick(): void;
}) {
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
      TextStyle,
      Color,
      FontSize,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
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
          "ProseMirror-host max-w-none min-h-[6rem] rounded-lg border border-black/10 px-3 py-2 text-sm text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500",
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

  const currentSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? "#1c1917";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1" role="toolbar" aria-label={`${ariaLabel} formatting`}>
        <ToolbarButton isActive={editor.isActive("bold")} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton isActive={editor.isActive("italic")} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton isActive={editor.isActive("underline")} label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolbarButton isActive={editor.isActive("strike")} label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} />
        <ToolbarButton isActive={editor.isActive("heading", { level: 1 })} label="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolbarButton isActive={editor.isActive("heading", { level: 2 })} label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton isActive={editor.isActive("bulletList")} label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton isActive={editor.isActive("orderedList")} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <select
          aria-label="Font size"
          className="ml-1 rounded border border-black/10 bg-white px-1 py-1 text-xs text-stone-900"
          onChange={(event) => {
            const value = event.target.value;
            if (value === "") {
              editor.chain().focus().unsetFontSize().run();
            } else {
              editor.chain().focus().setFontSize(value).run();
            }
          }}
          value={currentSize}
        >
          <option value="">Size</option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size.replace("px", "")}
            </option>
          ))}
        </select>
        <input
          aria-label="Text color"
          className="h-6 w-6 cursor-pointer rounded border border-black/10 bg-white p-0"
          onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          type="color"
          value={currentColor}
        />
        <ToolbarButton isActive={false} label="Clear color" onClick={() => editor.chain().focus().unsetColor().run()} />
        <ToolbarButton
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
      <EditorContent editor={editor} />
    </div>
  );
}
