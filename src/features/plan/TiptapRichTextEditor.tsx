import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Ellipsis,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Palette,
  Quote,
  Strikethrough,
  Type,
  Underline,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  hexFromRgb,
  rgbFromHex,
  validRgb,
  type RgbColor,
} from "./colorValue";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  onBlockHtmlChange?(sourceHtml: string, blocks: string[]): void;
}

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 32];
const DEFAULT_BLOCK_FONT_SIZE = 16;
const HEADING_FONT_SIZES: Record<number, number> = {
  1: 32,
  2: 24,
  3: 20,
  4: 18,
  5: 16,
  6: 14,
};
const DEFAULT_TEXT_COLOR = "#202329";
const THEME_TEXT_COLORS = [
  { label: "石墨黑", value: "#202329" },
  { label: "中性灰", value: "#6B6F76" },
  { label: "浆果红", value: "#C2385C" },
  { label: "深红", value: "#B42342" },
  { label: "琥珀", value: "#C78218" },
  { label: "松绿", value: "#2F7D65" },
  { label: "功能青", value: "#0891B2" },
  { label: "钴蓝", value: "#2563A9" },
  { label: "鸢尾紫", value: "#6F56A6" },
  { label: "白色", value: "#FFFFFF" },
] as const;

type FormattingSurface = "block" | "size" | "color" | "link" | "more";
type FloatingSurfaceAlign = "start" | "center" | "end";
type RgbDraft = Record<keyof RgbColor, string>;
type SelectionRange = { from: number; to: number };

function normalizedHex(value: string | undefined): string | null {
  if (!value) return null;
  const parsedHex = rgbFromHex(value);
  if (parsedHex) return hexFromRgb(parsedHex);
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value);
  return match
    ? hexFromRgb({ red: Number(match[1]), green: Number(match[2]), blue: Number(match[3]) })
    : null;
}

function draftFromColor(color: string): RgbDraft {
  const rgb = rgbFromHex(normalizedHex(color) ?? DEFAULT_TEXT_COLOR)!;
  return { red: String(rgb.red), green: String(rgb.green), blue: String(rgb.blue) };
}

function rgbFromDraft(draft: RgbDraft): RgbColor | null {
  if (Object.values(draft).some((value) => !/^\d+$/.test(value))) return null;
  return validRgb({
    red: Number(draft.red),
    green: Number(draft.green),
    blue: Number(draft.blue),
  });
}

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

function hsvFromRgb({ red, green, blue }: RgbColor): HsvColor {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta && max === r) h = 60 * (((g - b) / delta) % 6);
  else if (delta && max === g) h = 60 * ((b - r) / delta + 2);
  else if (delta) h = 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;
  return { h, s: max ? delta / max : 0, v: max };
}

function rgbFromHsv({ h, s, v }: HsvColor): RgbColor {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - chroma;
  const values = h < 60
    ? [chroma, x, 0]
    : h < 120
      ? [x, chroma, 0]
      : h < 180
        ? [0, chroma, x]
        : h < 240
          ? [0, x, chroma]
          : h < 300
            ? [x, 0, chroma]
            : [chroma, 0, x];
  return {
    red: Math.round((values[0] + m) * 255),
    green: Math.round((values[1] + m) * 255),
    blue: Math.round((values[2] + m) * 255),
  };
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as React.MutableRefObject<T | null>).current = value;
}

interface FloatingSurfaceProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  ariaLabel?: string;
  children: React.ReactNode;
  className: string;
  id: string;
  open: boolean;
  role?: React.AriaRole;
  width: number;
  align?: FloatingSurfaceAlign;
}

function FloatingSurface({
  anchorRef,
  ariaLabel,
  children,
  className,
  id,
  open,
  role,
  width,
  align = "start",
}: FloatingSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;
    const margin = 8;
    const gap = 5;
    const anchorRect = anchor.getBoundingClientRect();
    const surfaceWidth = Math.min(width, window.innerWidth - margin * 2);
    const surfaceHeight = surface.getBoundingClientRect().height;
    const alignedLeft = align === "center"
      ? anchorRect.left + (anchorRect.width - surfaceWidth) / 2
      : align === "end"
        ? anchorRect.right - surfaceWidth
        : anchorRect.left;
    const left = Math.min(window.innerWidth - surfaceWidth - margin, Math.max(margin, alignedLeft));
    const below = anchorRect.bottom + gap;
    const above = anchorRect.top - surfaceHeight - gap;
    const top = below + surfaceHeight <= window.innerHeight - margin || above < margin
      ? Math.min(below, window.innerHeight - surfaceHeight - margin)
      : above;
    setPosition({ left, top: Math.max(margin, top), ready: true });
  }, [align, anchorRef, width]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  if (!open) return null;
  return createPortal(
    <div
      aria-label={ariaLabel}
      className={`fixed z-[1000] ${className}`}
      data-preshot-surface="true"
      id={id}
      ref={surfaceRef}
      role={role}
      style={{
        left: position.left,
        top: position.top,
        width: `min(${width}px, calc(100vw - 16px))`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function ToolButton({
  active = false,
  ariaLabel,
  children,
  onRun,
}: {
  active?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  onRun(): void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`preshot-tool-button grid h-7 w-7 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional ${active ? "bg-app-primary-soft text-app-primary" : "text-app-ink hover:bg-app-primary-soft"}`}
      onClick={(event) => {
        if (event.detail === 0) onRun();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onRun();
      }}
      type="button"
    >
      {children}
    </button>
  );
}

const BLOCK_TYPES = [
  { label: "段落", icon: Type, run: (editor: Editor) => editor.chain().focus().setParagraph().run() },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    label: `${["一", "二", "三", "四", "五", "六"][level - 1]}级标题`,
    icon: [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6][level - 1],
    run: (editor: Editor) => editor.chain().focus().unsetFontSize().setHeading({ level }).run(),
  })),
  { label: "引用", icon: Quote, run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run() },
  { label: "无序列表", icon: List, run: (editor: Editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "有序列表", icon: ListOrdered, run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run() },
];

function currentBlock(editor: Editor) {
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive("heading", { level })) return BLOCK_TYPES[level];
  }
  if (editor.isActive("blockquote")) return BLOCK_TYPES[7];
  if (editor.isActive("bulletList")) return BLOCK_TYPES[8];
  if (editor.isActive("orderedList")) return BLOCK_TYPES[9];
  return BLOCK_TYPES[0];
}

function parseFontSize(value: unknown) {
  if (typeof value !== "string") return null;
  const size = Number.parseFloat(value);
  return Number.isFinite(size) ? size : null;
}

function blockFontSizeAt(editor: Editor, position: number) {
  const resolved = editor.state.doc.resolve(Math.min(position, editor.state.doc.content.size));
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === "heading") {
      return HEADING_FONT_SIZES[Number(node.attrs.level)] ?? DEFAULT_BLOCK_FONT_SIZE;
    }
  }
  return DEFAULT_BLOCK_FONT_SIZE;
}

function currentFontSize(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    return parseFontSize(editor.getAttributes("textStyle").fontSize) ?? blockFontSizeAt(editor, from);
  }

  const sizes = new Set<number>();
  editor.state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return;
    const textStyle = node.marks.find((mark) => mark.type.name === "textStyle");
    sizes.add(parseFontSize(textStyle?.attrs.fontSize) ?? blockFontSizeAt(editor, position));
  });
  if (sizes.size === 0) sizes.add(blockFontSizeAt(editor, from));
  return sizes.size === 1 ? sizes.values().next().value ?? null : null;
}

function BlockTypeControl({
  editor,
  open,
  onOpenChange,
  restoreSelection,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange(open: boolean): void;
  restoreSelection(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = currentBlock(editor);
  const SelectedIcon = selected.icon;
  const apply = (item: (typeof BLOCK_TYPES)[number]) => {
    restoreSelection();
    item.run(editor);
    onOpenChange(false);
  };
  return (
    <div className="relative shrink-0">
      <button
        aria-controls="block-type-options"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={selected.label}
        className="preshot-block-trigger flex h-7 min-w-[4.8rem] items-center justify-center gap-1 rounded px-2 text-xs text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        data-preshot-popup="block"
        onClick={(event) => event.detail === 0 && onOpenChange(!open)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
        ref={triggerRef}
        type="button"
      >
        <SelectedIcon aria-hidden size={15} />
        <span>{selected.label}</span>
        <ChevronDown aria-hidden size={13} strokeWidth={1.8} />
      </button>
      <FloatingSurface
        anchorRef={triggerRef}
        className="max-h-[min(26.25rem,calc(100vh-1rem))] overflow-y-auto rounded border border-app-border bg-app-panel-strong p-1 shadow-[var(--app-shadow)]"
        id="block-type-options"
        open={open}
        role="menu"
        width={220}
      >
        {BLOCK_TYPES.map((item) => {
          const Icon = item.icon;
          const active = selected.label === item.label;
          return (
            <button
              className="flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-xs leading-5 text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
              key={item.label}
              onClick={(event) => event.detail === 0 && apply(item)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                apply(item);
              }}
              role="menuitem"
              type="button"
            >
              <span className="grid w-4 place-items-center">{active ? <Check aria-hidden size={13} /> : null}</span>
              <Icon aria-hidden size={15} />
              {item.label}
            </button>
          );
        })}
      </FloatingSurface>
    </div>
  );
}

function FontSizeControl({
  value,
  open,
  onOpenChange,
  onApply,
}: {
  value: number | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onApply(size: number): void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  return (
    <div className="relative mx-1 flex h-7 shrink-0 rounded border border-app-border bg-app-panel-strong" ref={triggerRef}>
      <button
        aria-label={`当前字号 ${value ?? "混合"}`}
        className="w-10 px-1 text-center text-xs tabular-nums text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
        type="button"
      >
        {value ?? "-"}
      </button>
      <button
        aria-controls="font-size-options"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="选择字号"
        className="grid w-6 place-items-center border-l border-app-border text-app-muted hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        data-preshot-popup="size"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
        type="button"
      >
        <ChevronDown aria-hidden size={14} />
      </button>
      <FloatingSurface
        anchorRef={triggerRef}
        ariaLabel="字号"
        className="rounded border border-app-border bg-app-panel-strong p-1 shadow-[var(--app-shadow)]"
        id="font-size-options"
        open={open}
        role="listbox"
        width={86}
      >
        {FONT_SIZES.map((size) => (
          <button
            aria-selected={size === value}
            className="flex h-7 w-full items-center rounded px-2 text-left text-xs tabular-nums text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            key={size}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onApply(size);
            }}
            role="option"
            type="button"
          >
            <span className="grid w-4 place-items-center">{size === value ? <Check aria-hidden size={13} /> : null}</span>
            {size}
          </button>
        ))}
      </FloatingSurface>
    </div>
  );
}

function CircularColorPicker({ color, onChange }: { color: string; onChange(color: string): void }) {
  const currentRgb = rgbFromHex(normalizedHex(color) ?? DEFAULT_TEXT_COLOR)!;
  const hsv = hsvFromRgb(currentRgb);
  const wheelRef = useRef<HTMLDivElement>(null);
  const update = (next: HsvColor) => {
    onChange(hexFromRgb(rgbFromHsv(next))!);
  };
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const radius = rect.width / 2;
    update({
      ...hsv,
      h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360,
      s: Math.min(1, Math.hypot(dx, dy) / radius),
    });
  };
  const markerRadius = hsv.s * 50;
  const angle = hsv.h * Math.PI / 180;
  return (
    <div>
      <div
        aria-label="圆形颜色选择盘"
        className="relative aspect-square w-[9.25rem] cursor-crosshair rounded-full border border-app-border shadow-inner"
        onPointerDown={pick}
        ref={wheelRef}
        role="application"
        style={{
          background: "radial-gradient(circle, #fff 0%, rgb(255 255 255 / 0%) 70%), conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#202329,0_1px_4px_rgb(0_0_0_/_45%)]"
          style={{
            left: `${50 + Math.cos(angle) * markerRadius}%`,
            top: `${50 + Math.sin(angle) * markerRadius}%`,
          }}
        />
      </div>
      <label className="mt-2 grid grid-cols-[2rem_1fr] items-center gap-2 text-[10px] text-app-muted">
        明度
        <input
          aria-label="颜色明度"
          className="accent-app-primary"
          max={100}
          min={0}
          onChange={(event) => update({ ...hsv, v: Number(event.target.value) / 100 })}
          type="range"
          value={Math.round(hsv.v * 100)}
        />
      </label>
    </div>
  );
}

function FontColorControl({
  color,
  open,
  onOpenChange,
  onApply,
}: {
  color: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onApply(color: string): void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<RgbDraft>(() => draftFromColor(color));
  const rgb = rgbFromDraft(draft);
  const customHex = rgb ? hexFromRgb(rgb) : null;
  const apply = (value: string) => {
    const normalized = normalizedHex(value);
    if (!normalized) return;
    onApply(normalized);
    setCustomOpen(false);
    onOpenChange(false);
  };
  const openCustom = () => {
    setDraft(draftFromColor(color));
    setCustomOpen(true);
  };
  return (
    <div className="relative mx-1 flex h-7 shrink-0 rounded border border-app-border bg-app-panel-strong" ref={triggerRef}>
      <button
        aria-label="应用当前文字颜色"
        className="relative grid w-8 place-items-center pb-1 text-base text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          apply(color);
        }}
        style={{ textDecorationColor: color, textDecorationLine: "underline", textDecorationThickness: "3px", textUnderlineOffset: "3px" }}
        type="button"
      >
        A
      </button>
      <button
        aria-controls="font-color-options"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="选择文字颜色"
        className="preshot-color-trigger grid w-6 place-items-center border-l border-app-border text-app-muted hover:bg-app-primary-soft hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        data-preshot-popup="color"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
        type="button"
      >
        <ChevronDown aria-hidden size={14} />
      </button>
      <FloatingSurface
        align="center"
        anchorRef={triggerRef}
        ariaLabel={customOpen ? "更多颜色" : "文字颜色"}
        className="max-h-[calc(100vh-1rem)] overflow-y-auto rounded border border-app-border bg-app-panel-strong p-2 shadow-[var(--app-shadow)]"
        id="font-color-options"
        open={open}
        role={customOpen ? "dialog" : "listbox"}
        width={customOpen ? 260 : 148}
      >
        {customOpen ? (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-app-ink">
              自定义颜色
              <button
                aria-label="关闭更多颜色"
                className="grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-primary-soft hover:text-app-primary"
                onClick={() => setCustomOpen(false)}
                type="button"
              >
                <X aria-hidden size={14} />
              </button>
            </div>
            <div className="grid grid-cols-[9.25rem_minmax(0,1fr)] gap-3">
              <CircularColorPicker
                color={customHex ?? color}
                onChange={(value) => setDraft(draftFromColor(value))}
              />
              <div className="min-w-0">
                <div className="mb-2 h-7 rounded border border-app-border" style={{ background: customHex ?? color }} />
                {(["red", "green", "blue"] as const).map((channel) => (
                  <label className="mb-1 grid grid-cols-[0.9rem_minmax(0,1fr)] items-center gap-1 text-xs text-app-muted" key={channel}>
                    {channel.charAt(0).toUpperCase()}
                    <input
                      aria-invalid={!customHex}
                      aria-label={`${channel.charAt(0).toUpperCase()} 颜色值`}
                      className="h-7 min-w-0 rounded border border-app-border bg-app-panel px-1 text-right text-xs text-app-ink outline-none focus:border-app-functional focus:ring-1 focus:ring-app-functional"
                      inputMode="numeric"
                      max={255}
                      min={0}
                      onChange={(event) => setDraft((current) => ({ ...current, [channel]: event.target.value }))}
                      type="number"
                      value={draft[channel]}
                    />
                  </label>
                ))}
                <div className="mt-1 text-[10px] tabular-nums text-app-muted">{customHex ?? "请输入 0-255"}</div>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="h-7 rounded border border-app-border px-2 text-xs text-app-ink" onClick={() => setCustomOpen(false)} type="button">取消</button>
              <button
                className="h-7 rounded bg-app-primary px-2 text-xs font-semibold text-white disabled:opacity-40"
                disabled={!customHex}
                onClick={() => customHex && apply(customHex)}
                type="button"
              >
                应用
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-2 text-[10px] text-app-muted">主题颜色</div>
            <div className="grid grid-cols-5 gap-1">
              {THEME_TEXT_COLORS.map((option) => (
                <button
                  aria-label={`${option.label} ${option.value}`}
                  aria-selected={option.value === color}
                  className="grid h-[22px] w-[22px] place-items-center rounded border border-app-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
                  key={option.value}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    apply(option.value);
                  }}
                  role="option"
                  style={{ background: option.value }}
                  type="button"
                >
                  {option.value === color ? <Check aria-hidden color="#FFFFFF" size={13} /> : null}
                </button>
              ))}
            </div>
            <button
              className="mt-2 h-7 w-full border-t border-app-border text-left text-xs text-app-ink hover:text-app-primary"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openCustom();
              }}
              type="button"
            >
              <Palette aria-hidden className="mr-1 inline" size={13} />
              更多颜色...
            </button>
          </>
        )}
      </FloatingSurface>
    </div>
  );
}

function LinkControl({
  editor,
  open,
  onOpenChange,
  restoreSelection,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange(open: boolean): void;
  restoreSelection(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState("");
  const apply = () => {
    const trimmed = url.trim();
    restoreSelection();
    if (!trimmed) editor.chain().focus().unsetLink().run();
    else {
      const href = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onOpenChange(false);
  };
  return (
    <div className="relative shrink-0">
      <button
        aria-controls="link-options"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="添加链接"
        className="grid h-7 w-8 place-items-center rounded text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        data-preshot-popup="link"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setUrl(editor.getAttributes("link").href ?? "");
          onOpenChange(!open);
        }}
        ref={triggerRef}
        type="button"
      >
        <LinkIcon aria-hidden size={16} />
      </button>
      <FloatingSurface align="end" anchorRef={triggerRef} className="rounded border border-app-border bg-app-panel-strong shadow-[var(--app-shadow)]" id="link-options" open={open} width={240}>
        <form aria-label="添加链接" className="flex w-full gap-2 p-2" onSubmit={(event) => { event.preventDefault(); apply(); }} role="dialog">
          <input aria-label="链接地址" autoFocus className="h-7 min-w-0 flex-1 rounded border border-app-border bg-app-panel px-2 text-xs text-app-ink outline-none" name="url" onChange={(event) => setUrl(event.target.value)} placeholder="输入 URL" value={url} />
          <button className="h-7 rounded bg-app-primary px-2 text-xs font-semibold text-white" type="submit">应用</button>
        </form>
      </FloatingSurface>
    </div>
  );
}

function MoreFormattingControl({
  editor,
  open,
  onOpenChange,
  restoreSelection,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange(open: boolean): void;
  restoreSelection(): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const run = (command: () => void) => {
    restoreSelection();
    command();
    onOpenChange(false);
  };
  const commands = [
    { label: "左对齐", icon: AlignLeft, active: editor.isActive({ textAlign: "left" }), run: () => editor.chain().focus().setTextAlign("left").run() },
    { label: "居中", icon: AlignCenter, active: editor.isActive({ textAlign: "center" }), run: () => editor.chain().focus().setTextAlign("center").run() },
    { label: "右对齐", icon: AlignRight, active: editor.isActive({ textAlign: "right" }), run: () => editor.chain().focus().setTextAlign("right").run() },
    { label: "无序列表", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "有序列表", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "引用", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: "代码块", icon: Code2, active: editor.isActive("codeBlock"), run: () => editor.chain().focus().toggleCodeBlock().run() },
    {
      label: "嵌套",
      icon: ChevronRight,
      active: false,
      run: () => editor.isActive("listItem")
        ? editor.chain().focus().sinkListItem("listItem").run()
        : editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "取消嵌套",
      icon: ChevronLeft,
      active: false,
      run: () => editor.isActive("listItem")
        ? editor.chain().focus().liftListItem("listItem").run()
        : editor.isActive("blockquote")
          ? editor.chain().focus().toggleBlockquote().run()
          : false,
    },
  ];
  return (
    <div className="preshot-more-control shrink-0">
      <button
        aria-controls="more-formatting-options"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="更多格式"
        className="grid h-7 w-7 place-items-center rounded text-app-ink hover:bg-app-primary-soft"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
        ref={triggerRef}
        type="button"
      >
        <Ellipsis aria-hidden size={16} />
      </button>
      <FloatingSurface
        align="end"
        anchorRef={triggerRef}
        ariaLabel="更多格式"
        className="rounded border border-app-border bg-app-panel-strong p-1 shadow-[var(--app-shadow)]"
        id="more-formatting-options"
        open={open}
        role="dialog"
        width={220}
      >
        <div className="flex min-h-9 items-center gap-1" role="toolbar">
          {commands.map((command) => {
            const Icon = command.icon;
            return (
              <ToolButton active={command.active} ariaLabel={command.label} key={command.label} onRun={() => run(command.run)}>
                <Icon aria-hidden size={15} />
              </ToolButton>
            );
          })}
        </div>
      </FloatingSurface>
    </div>
  );
}

function PreshotFormattingToolbar({ editor }: { editor: Editor }) {
  const [, setRevision] = useState(0);
  const toolbarScrollRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<SelectionRange>({ from: editor.state.selection.from, to: editor.state.selection.to });
  const [openSurface, setOpenSurface] = useState<FormattingSurface | null>(null);
  const [lastTextColor, setLastTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenSurface(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);
  useEffect(() => {
    if (!openSurface) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`[data-preshot-popup="${openSurface}"]`) || target.closest('[data-preshot-surface="true"]')) return;
      setOpenSurface(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [openSurface]);
  useLayoutEffect(() => {
    const track = toolbarScrollRef.current;
    if (!track) return;
    const update = () => {
      const maximum = track.scrollWidth - track.clientWidth;
      setScrollEdges({ left: track.scrollLeft > 1, right: track.scrollLeft < maximum - 1 });
    };
    const observer = new ResizeObserver(update);
    observer.observe(track);
    track.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      track.removeEventListener("scroll", update);
    };
  }, []);
  const captureSelection = () => {
    selectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
  };
  const restoreSelection = () => {
    editor.commands.setTextSelection(selectionRef.current);
  };
  const run = (command: () => void) => {
    restoreSelection();
    command();
  };
  const fontSize = currentFontSize(editor);
  const activeTextColor = normalizedHex(editor.getAttributes("textStyle").color) ?? lastTextColor;
  const applyFontSize = (size: number) => {
    restoreSelection();
    editor.chain().focus().setFontSize(`${size}px`).run();
    setOpenSurface(null);
  };
  const applyTextColor = (color: string) => {
    const normalized = normalizedHex(color);
    if (!normalized) return;
    const selection = selectionRef.current;
    editor
      .chain()
      .focus()
      .setTextSelection(selection)
      .setColor(normalized)
      .setTextSelection(selection.to)
      .run();
    selectionRef.current = { from: selection.to, to: selection.to };
    setLastTextColor(normalized);
    setOpenSurface(null);
  };
  const scrollToolbar = (direction: "left" | "right") => {
    const track = toolbarScrollRef.current;
    if (!track) return;
    track.scrollBy({ left: direction === "left" ? -120 : 120, behavior: "smooth" });
  };
  return (
    <div
      className="preshot-formatting-toolbar"
      data-persistent-formatting-toolbar="true"
      onMouseDownCapture={(event) => {
        captureSelection();
        if ((event.target as Element).closest("button")) event.preventDefault();
      }}
      onPointerDownCapture={captureSelection}
      role="toolbar"
    >
      <div className="preshot-tiptap-toolbar group relative min-h-9 w-full overflow-hidden border-b border-app-border bg-app-panel-strong shadow-[0_2px_8px_rgb(24_24_27_/_6%)]">
        <button
          aria-label="向左移动工具栏"
          className={`absolute left-0 top-1 z-10 h-7 w-7 place-items-center rounded-r bg-app-ink/90 text-white shadow-md hover:bg-app-primary ${scrollEdges.left ? "hidden group-hover:grid" : "hidden"}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            scrollToolbar("left");
          }}
          type="button"
        >
          <ChevronLeft aria-hidden size={16} />
        </button>
        <div className="preshot-toolbar-scroll flex h-9 min-w-0 w-full items-center gap-1 overflow-x-auto px-1" ref={toolbarScrollRef}>
          <BlockTypeControl editor={editor} onOpenChange={(open) => setOpenSurface(open ? "block" : null)} open={openSurface === "block"} restoreSelection={restoreSelection} />
          <div className="contents" data-toolbar-leading="true">
            <ToolButton active={editor.isActive("bold")} ariaLabel="加粗" onRun={() => run(() => { editor.chain().focus().toggleBold().run(); })}><Bold aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive("italic")} ariaLabel="斜体" onRun={() => run(() => { editor.chain().focus().toggleItalic().run(); })}><Italic aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive("underline")} ariaLabel="下划线" onRun={() => run(() => { editor.chain().focus().toggleUnderline().run(); })}><Underline aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive("strike")} ariaLabel="删除线" onRun={() => run(() => { editor.chain().focus().toggleStrike().run(); })}><Strikethrough aria-hidden size={15} /></ToolButton>
          </div>
          <FontSizeControl onApply={applyFontSize} onOpenChange={(open) => setOpenSurface(open ? "size" : null)} open={openSurface === "size"} value={fontSize} />
          <div className="contents" data-toolbar-color="true">
            <FontColorControl color={activeTextColor} onApply={applyTextColor} onOpenChange={(open) => setOpenSurface(open ? "color" : null)} open={openSurface === "color"} />
          </div>
          <div className="contents" data-toolbar-secondary="true">
            <ToolButton active={editor.isActive({ textAlign: "left" })} ariaLabel="左对齐" onRun={() => run(() => { editor.chain().focus().setTextAlign("left").run(); })}><AlignLeft aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive({ textAlign: "center" })} ariaLabel="居中" onRun={() => run(() => { editor.chain().focus().setTextAlign("center").run(); })}><AlignCenter aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive({ textAlign: "right" })} ariaLabel="右对齐" onRun={() => run(() => { editor.chain().focus().setTextAlign("right").run(); })}><AlignRight aria-hidden size={15} /></ToolButton>
          </div>
          <div className="contents" data-toolbar-link="true">
            <LinkControl editor={editor} onOpenChange={(open) => setOpenSurface(open ? "link" : null)} open={openSurface === "link"} restoreSelection={restoreSelection} />
          </div>
          <MoreFormattingControl editor={editor} onOpenChange={(open) => setOpenSurface(open ? "more" : null)} open={openSurface === "more"} restoreSelection={restoreSelection} />
        </div>
        <button
          aria-label="向右移动工具栏"
          className={`absolute right-0 top-1 z-10 h-7 w-7 place-items-center rounded-l bg-app-ink/90 text-white shadow-md hover:bg-app-primary ${scrollEdges.right ? "hidden group-hover:grid" : "hidden"}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            scrollToolbar("right");
          }}
          type="button"
        >
          <ChevronRight aria-hidden size={16} />
        </button>
      </div>
    </div>
  );
}

function serializeTopLevelBlocks(editor: Editor): string[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  return editor.state.doc.content.content.map((node) => {
    const container = document.createElement("div");
    container.append(serializer.serializeNode(node));
    return container.innerHTML;
  });
}

export function RichTextEditor({
  html,
  onChange,
  ariaLabel,
  placeholder,
  compact,
  rootRef,
  onBlockHtmlChange,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  const onBlockHtmlChangeRef = useRef(onBlockHtmlChange);
  const lastPropHtmlRef = useRef<string | null>(null);
  const lastEmitRef = useRef<string | null>(null);
  const lastBlockHtmlRef = useRef<string | null>(null);
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, defaultProtocol: "https" },
    }),
    TextStyle,
    Color,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({ placeholder: placeholder ?? "" }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ], [placeholder]);
  const emitBlockHtml = useCallback((editorInstance: Editor, sourceHtml: string) => {
    const callback = onBlockHtmlChangeRef.current;
    if (!callback) return;
    const blocks = serializeTopLevelBlocks(editorInstance);
    const serialized = JSON.stringify({ sourceHtml, blocks });
    if (serialized === lastBlockHtmlRef.current) return;
    lastBlockHtmlRef.current = serialized;
    callback(sourceHtml, blocks);
  }, []);
  const editor = useEditor({
    extensions,
    content: html.trim() ? html : "<p></p>",
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        class: "tiptap-editor",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: editorInstance }) => {
      const next = editorInstance.getHTML();
      if (next === lastEmitRef.current) return;
      lastEmitRef.current = next;
      lastPropHtmlRef.current = next;
      onChangeRef.current(next);
      emitBlockHtml(editorInstance, next);
    },
  });
  const setRootRef = useCallback((node: HTMLDivElement | null) => assignRef(rootRef, node), [rootRef]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onBlockHtmlChangeRef.current = onBlockHtmlChange;
  }, [onBlockHtmlChange]);
  useEffect(() => {
    if (!editor || html === lastPropHtmlRef.current) return;
    const content = html.trim() ? html : "<p></p>";
    editor.commands.setContent(content, { emitUpdate: false });
    lastPropHtmlRef.current = html;
    lastEmitRef.current = editor.getHTML();
    emitBlockHtml(editor, html);
  }, [editor, emitBlockHtml, html]);

  return (
    <div
      aria-label={ariaLabel}
      className={`preshot-editor-wrap${compact ? " preshot-editor-compact" : ""}`}
      data-editor-engine="tiptap"
      data-placeholder={placeholder}
      ref={setRootRef}
      role="group"
    >
      <div className="preshot-editor-container">
        {editor ? <PreshotFormattingToolbar editor={editor} /> : null}
        <EditorContent className="preshot-editor-content" editor={editor} />
      </div>
    </div>
  );
}