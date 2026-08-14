import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
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
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Images,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Palette,
  Plus,
  Quote,
  Strikethrough,
  Trash2,
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
import type { ReferenceComponent } from "../../domain/plan/canvas/models";
import type { MoveImageParams } from "../../domain/plan/canvas/plan";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import {
  createBlankLineImageGroupInsertExtension,
  createDocumentImageGroupExtension,
  insertImageGroupAtBlankLine,
  insertImageGroupAtDocumentEnd,
  type BlankLineInsertAnchor,
  type DocumentImageGroupController,
} from "./DocumentImageGroupExtension";
import { IMAGE_GROUP_NODE_NAME } from "../../domain/plan/canvas/document";
import {
  createDocumentPaginationExtension,
  paginateDocument,
  type DocumentPaginationOptions,
} from "./DocumentPaginationExtension";

interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  onBlockHtmlChange?(sourceHtml: string, blocks: string[]): void;
  onInsertImage?(): Promise<RichTextImageAsset | null>;
  resolveImageSrc?(file: string): string | undefined;
  documentMode?: {
    imageGroups: readonly ReferenceComponent[];
    imageSrc(file: string): string | undefined;
    onCreateImageGroup(id: string): void;
    onAddImages(id: string): void;
    onOpenImage(componentId: string, imageId: string, file: string): void;
    onRemoveImage(componentId: string, imageId: string): void;
    onMoveImage(params: MoveImageParams): void;
    onRemoveImageGroup(id: string): void;
    onResizeImageGroup(
      id: string,
      rect: {
        x?: number;
        width?: number;
        height?: number;
        frameOffsetY?: number;
      },
    ): void;
    onSetImageFrame(
      componentId: string,
      imageId: string,
      frame: {
        frameWidth: number;
        frameHeight: number;
        frameOffsetX?: number;
        frameOffsetY?: number;
      },
    ): void;
    scale: number;
    onActivateBlankLine?(anchor: BlankLineInsertAnchor | null): void;
    registerInsertImageGroup?(insert: (() => void) | null): void;
    registerInsertImageGroupAt?(insert: ((position: number) => void) | null): void;
    registerPaginator?(paginate: ((options: DocumentPaginationOptions, onComplete: (pageCount: number) => void) => () => void) | null): void;
  };
}

export interface RichTextImageAsset {
  file: string;
  dataUrl: string;
  alt?: string;
  width?: number;
  height?: number;
}

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
  { label: "标准红", value: "#D92D20" },
  { label: "标准橙", value: "#F79009" },
  { label: "标准绿", value: "#84CC16" },
  { label: "标准青", value: "#06B6D4" },
  { label: "深蓝", value: "#1D4ED8" },
  { label: "深紫", value: "#581C87" },
  { label: "纯黑", value: "#000000" },
  { label: "白色", value: "#FFFFFF" },
] as const;

type FormattingSurface = "block" | "size" | "color" | "link" | "more";
type FloatingSurfaceAlign = "start" | "center" | "end";
type RgbDraft = Record<keyof RgbColor, string>;
type SelectionRange = { from: number; to: number };

const ProjectImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetSrc: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-asset-src") ??
          (element.getAttribute("src")?.startsWith("references/")
            ? element.getAttribute("src")
            : null),
        renderHTML: (attributes) =>
          attributes.assetSrc
            ? { "data-asset-src": String(attributes.assetSrc) }
            : {},
      },
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width"),
        renderHTML: (attributes) =>
          attributes.width ? { width: String(attributes.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (element) => element.getAttribute("height"),
        renderHTML: (attributes) =>
          attributes.height ? { height: String(attributes.height) } : {},
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;
      let activePointerId: number | null = null;
      let startX = 0;
      let startY = 0;
      let startWidth = 0;
      let aspectRatio = 1;
      let previewWidth = 0;
      let previewHeight = 0;
      const container = document.createElement("div");
      container.dataset.resizeContainer = "";
      container.dataset.node = "image";
      const wrapper = document.createElement("div");
      wrapper.dataset.resizeWrapper = "";
      const frame = document.createElement("figure");
      frame.className = "preshot-resizable-image-frame";
      const image = document.createElement("img");
      image.draggable = false;
      frame.append(image);
      const handle = document.createElement("button");
      handle.type = "button";
      handle.ariaLabel = "调整图片大小";
      handle.title = "拖动调整图片大小";
      handle.contentEditable = "false";
      handle.dataset.resizeHandle = "bottom-right";
      wrapper.append(frame, handle);
      container.append(wrapper);

      const applyDimensions = (width: number, height: number) => {
        previewWidth = width;
        previewHeight = height;
        container.style.width = `${width}px`;
        frame.style.aspectRatio = `${width} / ${height}`;
      };

      const applyNode = (nextNode: typeof node) => {
        if (nextNode.type !== node.type) return false;
        currentNode = nextNode;
        const { src, alt, title, assetSrc, width, height } = nextNode.attrs;
        if (typeof src === "string" && image.getAttribute("src") !== src) {
          image.src = src;
        }
        image.alt = typeof alt === "string" ? alt : "";
        if (typeof title === "string" && title) image.title = title;
        else image.removeAttribute("title");
        if (typeof assetSrc === "string" && assetSrc) {
          image.dataset.assetSrc = assetSrc;
        } else {
          image.removeAttribute("data-asset-src");
        }
        if (Number(width) > 0 && Number(height) > 0) {
          applyDimensions(Number(width), Number(height));
        }
        return true;
      };

      const stopResize = () => {
        document.removeEventListener("pointermove", resize);
        document.removeEventListener("pointerup", commitResize);
        document.removeEventListener("pointercancel", cancelResize);
        activePointerId = null;
        container.dataset.resizeState = "false";
      };
      const resize = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        const deltaX = event.clientX - startX;
        const deltaY = (event.clientY - startY) * aspectRatio;
        const requestedWidth = startWidth +
          (Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY);
        const maximumWidth = editor.view.dom.clientWidth || Number.POSITIVE_INFINITY;
        const minimumWidth = Math.min(maximumWidth, Math.max(48, aspectRatio * 32));
        const width = Math.min(maximumWidth, Math.max(minimumWidth, requestedWidth));
        applyDimensions(width, width / aspectRatio);
      };
      const commitResize = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        stopResize();
        const position = getPos();
        if (position === undefined) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(position, undefined, {
            ...currentNode.attrs,
            width: Math.round(previewWidth),
            height: Math.round(previewHeight),
          }),
        );
      };
      const cancelResize = (event: PointerEvent) => {
        if (event.pointerId !== activePointerId) return;
        stopResize();
        applyNode(currentNode);
      };
      const startResize = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        activePointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        const rect = frame.getBoundingClientRect();
        startWidth = rect.width || Number(currentNode.attrs.width) || 1;
        const startHeight = rect.height || Number(currentNode.attrs.height) || 1;
        aspectRatio = startWidth / startHeight;
        previewWidth = startWidth;
        previewHeight = startHeight;
        container.dataset.resizeState = "true";
        try {
          handle.setPointerCapture?.(event.pointerId);
        } catch {
          // Synthetic pointer events may not have an active browser pointer.
        }
        document.addEventListener("pointermove", resize);
        document.addEventListener("pointerup", commitResize);
        document.addEventListener("pointercancel", cancelResize);
      };
      handle.addEventListener("pointerdown", startResize);
      image.addEventListener("pointerdown", () => {
        const position = getPos();
        if (position !== undefined) editor.commands.setNodeSelection(position);
      });
      image.addEventListener("load", () => {
        if (Number(currentNode.attrs.width) > 0 && Number(currentNode.attrs.height) > 0) return;
        const width = Math.min(image.naturalWidth || 1, editor.view.dom.clientWidth || Number.POSITIVE_INFINITY);
        const ratio = (image.naturalWidth || 1) / (image.naturalHeight || 1);
        applyDimensions(width, width / ratio);
      });
      applyNode(node);
      return {
        dom: container,
        update: (nextNode: typeof node) => applyNode(nextNode),
        ignoreMutation: () => true,
        destroy: () => {
          stopResize();
          handle.removeEventListener("pointerdown", startResize);
        },
      };
    };
  },
});

function transformImageHtml(
  html: string,
  transform: (image: HTMLImageElement) => void,
): string {
  if (!html.includes("<img")) return html;
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  document.body.querySelectorAll("img").forEach(transform);
  return document.body.innerHTML;
}

function persistedImageHtml(html: string): string {
  return transformImageHtml(html, (image) => {
    const assetSrc = image.dataset.assetSrc;
    if (!assetSrc) return;
    image.setAttribute("src", assetSrc);
    image.removeAttribute("data-asset-src");
  });
}

function editorImageHtml(
  html: string,
  resolveImageSrc: RichTextEditorProps["resolveImageSrc"],
): string {
  return transformImageHtml(html, (image) => {
    const assetSrc = image.dataset.assetSrc ?? image.getAttribute("src");
    if (!assetSrc?.startsWith("references/")) return;
    image.dataset.assetSrc = assetSrc;
    image.setAttribute("src", resolveImageSrc?.(assetSrc) ?? assetSrc);
  });
}

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
      title={ariaLabel}
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
  { label: "任务列表", icon: ListTodo, run: (editor: Editor) => editor.chain().focus().toggleTaskList().run() },
  { label: "代码块", icon: Code2, run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run() },
];

function currentBlock(editor: Editor) {
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive("heading", { level })) return BLOCK_TYPES[level];
  }
  if (editor.isActive("blockquote")) return BLOCK_TYPES[7];
  if (editor.isActive("bulletList")) return BLOCK_TYPES[8];
  if (editor.isActive("orderedList")) return BLOCK_TYPES[9];
  if (editor.isActive("taskList")) return BLOCK_TYPES[10];
  if (editor.isActive("codeBlock")) return BLOCK_TYPES[11];
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

interface FontSizeState {
  minimum: number;
  mixed: boolean;
}

function currentFontSize(editor: Editor): FontSizeState {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    return {
      minimum: parseFontSize(editor.getAttributes("textStyle").fontSize) ?? blockFontSizeAt(editor, from),
      mixed: false,
    };
  }

  const sizes = new Set<number>();
  editor.state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return;
    const textStyle = node.marks.find((mark) => mark.type.name === "textStyle");
    sizes.add(parseFontSize(textStyle?.attrs.fontSize) ?? blockFontSizeAt(editor, position));
  });
  if (sizes.size === 0) sizes.add(blockFontSizeAt(editor, from));
  return {
    minimum: Math.min(...sizes),
    mixed: sizes.size > 1,
  };
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
        title={`段落类型：${selected.label}`}
        type="button"
      >
        <SelectedIcon aria-hidden size={15} />
        <span>{selected.label}</span>
        <ChevronDown aria-hidden size={13} strokeWidth={1.8} />
      </button>
      <FloatingSurface
        anchorRef={triggerRef}
        ariaLabel="块类型"
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
              title={item.label}
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
  onAdjust,
}: {
  value: FontSizeState;
  onAdjust(delta: number): void;
}) {
  return (
    <div className="preshot-font-stepper flex h-7 shrink-0 rounded border border-app-border bg-app-panel-strong">
      <button
        aria-label="减小字号"
        className="grid w-6 place-items-center text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onAdjust(-1);
        }}
        title="减小字号"
        type="button"
      >
        −
      </button>
      <span
        aria-label={value.mixed ? `混合字号，最小值 ${value.minimum} 像素` : `字号 ${value.minimum} 像素`}
        className="grid w-9 place-items-center border-x border-app-border text-xs tabular-nums text-app-ink"
      >
        {value.minimum}{value.mixed ? "+" : ""}
      </span>
      <button
        aria-label="增大字号"
        className="grid w-6 place-items-center text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onAdjust(1);
        }}
        title="增大字号"
        type="button"
      >
        +
      </button>
    </div>
  );
}

function FullColorPicker({ color, onChange }: { color: string; onChange(color: string): void }) {
  const currentRgb = rgbFromHex(normalizedHex(color) ?? DEFAULT_TEXT_COLOR)!;
  const hsv = hsvFromRgb(currentRgb);
  const spectrumRef = useRef<HTMLDivElement>(null);
  const update = (next: HsvColor) => {
    onChange(hexFromRgb(rgbFromHsv(next))!);
  };
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = spectrumRef.current?.getBoundingClientRect();
    if (!rect) return;
    update({
      ...hsv,
      h: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 360,
      s: 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_1.5rem] gap-2">
      <div
        aria-label="完整色相与饱和度色盘"
        className="relative h-36 cursor-crosshair overflow-hidden rounded border border-app-border shadow-inner"
        onPointerDown={pick}
        ref={spectrumRef}
        role="application"
        style={{
          background: "linear-gradient(to bottom, transparent, #fff), linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%)",
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_#202329,0_1px_4px_rgb(0_0_0_/_45%)]"
          style={{
            left: `${hsv.h / 360 * 100}%`,
            top: `${(1 - hsv.s) * 100}%`,
          }}
        />
      </div>
      <label className="flex flex-col items-center gap-1 text-[10px] text-app-muted">
        亮
        <input
          aria-label="颜色明度"
          className="h-32 accent-app-primary [direction:rtl] [writing-mode:vertical-lr]"
          max={100}
          min={0}
          onChange={(event) => update({ ...hsv, v: Number(event.target.value) / 100 })}
          type="range"
          value={Math.round(hsv.v * 100)}
        />
        暗
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
        title="应用当前文字颜色"
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
          setCustomOpen(false);
          onOpenChange(!open);
        }}
        title="选择文字颜色"
        type="button"
      >
        <ChevronDown aria-hidden size={14} />
      </button>
      <FloatingSurface
        align="center"
        anchorRef={triggerRef}
        ariaLabel="标准颜色"
        className="max-h-[calc(100vh-1rem)] overflow-y-auto rounded border border-app-border bg-app-panel-strong p-2 shadow-[var(--app-shadow)]"
        id="font-color-options"
        open={open && !customOpen}
        role="listbox"
        width={240}
      >
        <>
          <div className="mb-2 text-[10px] text-app-muted">Standard Colors</div>
          <div className="grid grid-cols-8 gap-1">
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
                  title={`${option.label} ${option.value}`}
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
            title="More Colors"
            type="button"
          >
            <Palette aria-hidden className="mr-1 inline" size={13} />
            More Colors...
          </button>
        </>
      </FloatingSurface>
      <FloatingSurface
        align="center"
        anchorRef={triggerRef}
        ariaLabel="更多颜色"
        className="rounded border border-app-border bg-app-panel-strong p-3 shadow-[var(--app-shadow)]"
        id="full-color-options"
        open={open && customOpen}
        role="dialog"
        width={380}
      >
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-app-ink">
          More Colors
          <button
            aria-label="关闭更多颜色"
            className="grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-primary-soft hover:text-app-primary"
            onPointerDown={(event) => {
              event.preventDefault();
              setCustomOpen(false);
              onOpenChange(false);
            }}
            title="关闭更多颜色"
            type="button"
          >
            <X aria-hidden size={14} />
          </button>
        </div>
        <div className="mb-3 text-[10px] text-app-muted">完整 RGB 色域 · Hue × Saturation × Brightness</div>
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] gap-3">
          <FullColorPicker
            color={customHex ?? color}
            onChange={(value) => setDraft(draftFromColor(value))}
          />
          <div className="min-w-0">
            <div className="mb-2 h-12 rounded border border-app-border" style={{ background: customHex ?? color }} />
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
          <button className="h-7 rounded border border-app-border px-2 text-xs text-app-ink" onPointerDown={(event) => {
            event.preventDefault();
            setCustomOpen(false);
            onOpenChange(false);
          }} type="button">取消</button>
          <button
            className="h-7 rounded bg-app-primary px-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!customHex}
            onPointerDown={(event) => {
              event.preventDefault();
              if (customHex) apply(customHex);
            }}
            type="button"
          >
            应用
          </button>
        </div>
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
        title="添加链接"
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
        title="更多格式"
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

function PreshotFormattingToolbar({
  editor,
  onInsertImage,
  contextual = false,
  imageGroupController,
  scale = 1,
}: {
  editor: Editor;
  onInsertImage?: RichTextEditorProps["onInsertImage"];
  contextual?: boolean;
  imageGroupController?: DocumentImageGroupController;
  scale?: number;
}) {
  const [revision, setRevision] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarScrollRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<SelectionRange>({ from: editor.state.selection.from, to: editor.state.selection.to });
  const [openSurface, setOpenSurface] = useState<FormattingSurface | null>(null);
  const [lastTextColor, setLastTextColor] = useState(DEFAULT_TEXT_COLOR);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
  const [insertingImage, setInsertingImage] = useState(false);
  const [contextPosition, setContextPosition] = useState({ left: 8, top: 60, placement: "top" });
  const [dismissedImageGroupId, setDismissedImageGroupId] = useState("");
  const selectedImageGroupId = editor.isActive(IMAGE_GROUP_NODE_NAME)
    ? String(editor.getAttributes(IMAGE_GROUP_NODE_NAME).groupId ?? "")
    : "";
  const selectedImageGroup = selectedImageGroupId
    ? imageGroupController?.getGroup(selectedImageGroupId)
    : undefined;
  const selectedImageId = selectedImageGroupId
    ? imageGroupController?.getSelectedImageId(selectedImageGroupId) ?? ""
    : "";
  const selectedImage = selectedImageGroup?.images.find(
    (image) => image.id === selectedImageId,
  );
  const hasTextSelection = editor.state.selection instanceof TextSelection && !editor.state.selection.empty;
  const contextualOpen = !contextual || (
    selectedImageGroup !== undefined
      ? dismissedImageGroupId !== selectedImageGroupId
      : editor.isFocused && hasTextSelection
  );
  useEffect(() => {
    if (!contextual || !selectedImageGroupId) return;
    const dismiss = () => setDismissedImageGroupId(selectedImageGroupId);
    const restoreOnGroupPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const group = target.closest<HTMLElement>("[data-image-group-id]");
      if (group?.dataset.imageGroupId === selectedImageGroupId) {
        setDismissedImageGroupId("");
      }
    };
    document.addEventListener("wheel", dismiss, { capture: true, passive: true });
    document.addEventListener("pointerdown", restoreOnGroupPointer, true);
    return () => {
      document.removeEventListener("wheel", dismiss, true);
      document.removeEventListener("pointerdown", restoreOnGroupPointer, true);
    };
  }, [contextual, selectedImageGroupId]);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    editor.on("focus", update);
    editor.on("blur", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
      editor.off("focus", update);
      editor.off("blur", update);
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
  useEffect(() => {
    if (!contextual) return;
    const clearOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-preshot-surface="true"]')) return;
      if (editor.state.selection.empty) return;
      const insideEditor = editor.view.dom.contains(target);
      const position = insideEditor
        ? editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.selection.to
        : editor.state.selection.to;
      editor.commands.setTextSelection(position);
      if (!insideEditor) {
        window.getSelection()?.removeAllRanges();
        editor.commands.blur();
      }
      setOpenSurface(null);
    };
    document.addEventListener("pointerdown", clearOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", clearOnOutsidePointer, true);
  }, [contextual, editor]);
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
  useLayoutEffect(() => {
    if (!contextual || !contextualOpen || !rootRef.current) return;
    let target: Element | null = null;
    let textSelectionRect: DOMRect | null = null;
    if (selectedImageGroupId) {
      target = editor.view.dom.querySelector(
        selectedImageId
          ? `[data-image-group-id="${CSS.escape(selectedImageGroupId)}"] [data-image-id="${CSS.escape(selectedImageId)}"]`
          : `[data-image-group-id="${CSS.escape(selectedImageGroupId)}"]`,
      );
    } else {
      const domAtPosition = editor.view.domAtPos(editor.state.selection.from).node;
      const element = domAtPosition instanceof Element
        ? domAtPosition
        : domAtPosition.parentElement;
      target = element?.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre") ?? editor.view.dom;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        textSelectionRect = selection.getRangeAt(0).getBoundingClientRect();
      }
    }
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const toolbarRect = rootRef.current.getBoundingClientRect();
    const inset = 8;
    const gap = 10 * scale;
    const anchorRect = textSelectionRect ?? targetRect;
    let left = selectedImageGroupId
      ? targetRect.right - toolbarRect.width
      : anchorRect.right + gap;
    if (!selectedImageGroupId && left + toolbarRect.width > window.innerWidth - inset) {
      left = anchorRect.right - toolbarRect.width;
    }
    left = Math.max(inset, Math.min(left, window.innerWidth - toolbarRect.width - inset));
    let top = anchorRect.top - toolbarRect.height - gap;
    let placement = "top";
    if (top < 60) {
      top = anchorRect.bottom + gap;
      placement = "bottom";
    }
    setContextPosition((current) =>
      current.left === left && current.top === top && current.placement === placement
        ? current
        : { left, top, placement },
    );
  }, [contextual, contextualOpen, editor, revision, scale, selectedImageGroupId, selectedImageId]);
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
  const adjustFontSize = (delta: number) => {
    applyFontSize(Math.max(8, Math.min(72, fontSize.minimum + delta)));
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
  const contextualStyle = contextual
    ? {
        left: `${contextPosition.left}px`,
        top: `${contextPosition.top}px`,
        transform: `scale(${scale})`,
        transformOrigin: "left top",
        visibility: contextualOpen ? "visible" as const : "hidden" as const,
      }
    : undefined;
  if (contextual && selectedImageGroup && selectedImage && imageGroupController) {
    return createPortal(
      <div
        aria-label="图片属性"
        className="preshot-formatting-toolbar preshot-contextual-toolbar"
        data-context-placement={contextPosition.placement}
        ref={rootRef}
        role="toolbar"
        style={contextualStyle}
      >
        <div className="flex h-[30px] items-center gap-1 rounded-md border border-white/10 bg-[#202329] px-1 text-white shadow-[0_8px_24px_rgb(17_18_22_/_24%)]">
          <span className="flex h-6 items-center gap-1 rounded bg-app-functional/20 px-2 text-[10px] font-bold text-cyan-100">
            <Images aria-hidden size={14} />图片
          </span>
          <button
            aria-label="删除图片"
            className="grid h-6 w-6 place-items-center rounded text-red-200 hover:bg-app-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
            onClick={() => imageGroupController.onRequestRemoveImage(selectedImageGroup.id, selectedImage.id)}
            title="删除图片"
            type="button"
          >
            <Trash2 aria-hidden size={14} />
          </button>
        </div>
      </div>,
      document.body,
    );
  }
  if (contextual && selectedImageGroup && imageGroupController) {
    return createPortal(
      <div
        aria-label="图片组属性"
        className="preshot-formatting-toolbar preshot-contextual-toolbar"
        data-context-placement={contextPosition.placement}
        ref={rootRef}
        role="toolbar"
        style={contextualStyle}
      >
        <div className="flex h-[30px] items-center gap-1 rounded-md border border-white/10 bg-[#202329] px-1 text-white shadow-[0_8px_24px_rgb(17_18_22_/_24%)]">
          <span className="flex h-6 items-center gap-1 rounded bg-app-functional/20 px-2 text-[10px] font-bold text-cyan-100">
            <Images aria-hidden size={14} />图片组
          </span>
          <button
            aria-label="添加图片"
            className="grid h-6 w-6 place-items-center rounded hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional"
            onClick={() => imageGroupController.onAddImages(selectedImageGroup.id)}
            title="添加图片"
            type="button"
          >
            <Plus aria-hidden size={15} />
          </button>
          <button
            aria-label="删除图片组"
            className="grid h-6 w-6 place-items-center rounded text-red-200 hover:bg-app-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-danger"
            onClick={() => imageGroupController.onRemoveGroup(selectedImageGroup.id)}
            title="删除图片组"
            type="button"
          >
            <Trash2 aria-hidden size={14} />
          </button>
        </div>
      </div>,
      document.body,
    );
  }
  const toolbar = (
    <div
      aria-label={contextual ? "文字属性" : undefined}
      className={`preshot-formatting-toolbar${contextual ? " preshot-contextual-toolbar" : ""}`}
      data-context-placement={contextual ? contextPosition.placement : undefined}
      data-persistent-formatting-toolbar={contextual ? undefined : "true"}
      onMouseDownCapture={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        captureSelection();
        if ((event.target as Element).closest("button")) event.preventDefault();
      }}
      onPointerDownCapture={(event) => {
        if (event.currentTarget.contains(event.target as Node)) captureSelection();
      }}
      ref={rootRef}
      role="toolbar"
      style={contextualStyle}
    >
      {contextual ? (
        <div className="preshot-contextual-formatting-rows">
          <div className="preshot-contextual-formatting-row">
            <BlockTypeControl editor={editor} onOpenChange={(open) => setOpenSurface(open ? "block" : null)} open={openSurface === "block"} restoreSelection={restoreSelection} />
            <FontSizeControl onAdjust={adjustFontSize} value={fontSize} />
            <FontColorControl color={activeTextColor} onApply={applyTextColor} onOpenChange={(open) => setOpenSurface(open ? "color" : null)} open={openSurface === "color"} />
          </div>
          <div className="preshot-contextual-formatting-row">
            <ToolButton active={editor.isActive("bold")} ariaLabel="加粗" onRun={() => run(() => { editor.chain().focus().toggleBold().run(); })}><Bold aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive("italic")} ariaLabel="倾斜" onRun={() => run(() => { editor.chain().focus().toggleItalic().run(); })}><Italic aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive("underline")} ariaLabel="下划线" onRun={() => run(() => { editor.chain().focus().toggleUnderline().run(); })}><Underline aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive("strike")} ariaLabel="删除线" onRun={() => run(() => { editor.chain().focus().toggleStrike().run(); })}><Strikethrough aria-hidden size={15} /></ToolButton>
            <span className="preshot-contextual-toolbar-divider" />
            <ToolButton active={editor.isActive({ textAlign: "left" })} ariaLabel="左对齐" onRun={() => run(() => { editor.chain().focus().setTextAlign("left").run(); })}><AlignLeft aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive({ textAlign: "center" })} ariaLabel="居中对齐" onRun={() => run(() => { editor.chain().focus().setTextAlign("center").run(); })}><AlignCenter aria-hidden size={15} /></ToolButton>
            <ToolButton active={editor.isActive({ textAlign: "right" })} ariaLabel="右对齐" onRun={() => run(() => { editor.chain().focus().setTextAlign("right").run(); })}><AlignRight aria-hidden size={15} /></ToolButton>
            <span className="preshot-contextual-toolbar-divider" />
            <ToolButton ariaLabel="减少缩进" onRun={() => run(() => {
              if (editor.isActive("listItem")) editor.chain().focus().liftListItem("listItem").run();
              else if (editor.isActive("blockquote")) editor.chain().focus().toggleBlockquote().run();
            })}><IndentDecrease aria-hidden size={15} /></ToolButton>
            <ToolButton ariaLabel="增加缩进" onRun={() => run(() => {
              if (editor.isActive("listItem")) editor.chain().focus().sinkListItem("listItem").run();
              else if (!editor.isActive("blockquote")) editor.chain().focus().toggleBlockquote().run();
            })}><IndentIncrease aria-hidden size={15} /></ToolButton>
          </div>
        </div>
      ) : (
        <div className="preshot-tiptap-toolbar group relative min-h-9 w-full overflow-hidden border-b border-app-border bg-app-panel-strong shadow-[0_2px_8px_rgb(24_24_27_/_6%)]">
          <button
            aria-label="向左移动工具栏"
            className={`absolute left-0 top-1 z-10 h-7 w-7 place-items-center rounded-r bg-app-ink/90 text-white shadow-md hover:bg-app-primary ${scrollEdges.left ? "hidden group-hover:grid" : "hidden"}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              scrollToolbar("left");
            }}
            title="向左移动工具栏"
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
            <FontSizeControl onAdjust={adjustFontSize} value={fontSize} />
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
          {onInsertImage ? (
            <button
              aria-label="插入图片"
              className="preshot-tool-button grid h-7 w-7 shrink-0 place-items-center rounded text-app-ink hover:bg-app-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-functional disabled:cursor-wait disabled:opacity-50"
              disabled={insertingImage}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                restoreSelection();
                setInsertingImage(true);
                void onInsertImage()
                  .then((asset) => {
                    if (!asset) return;
                    editor.chain().focus().insertContent({
                      type: "image",
                      attrs: {
                        src: asset.dataUrl,
                        alt: asset.alt ?? "",
                        assetSrc: asset.file,
                        width: asset.width,
                        height: asset.height,
                      },
                    }).run();
                  })
                  .finally(() => setInsertingImage(false));
              }}
              title="插入图片"
              type="button"
            >
              <ImagePlus aria-hidden size={15} />
            </button>
          ) : null}
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
            title="向右移动工具栏"
            type="button"
          >
            <ChevronRight aria-hidden size={16} />
          </button>
        </div>
      )}
    </div>
  );
  return contextual ? createPortal(toolbar, document.body) : toolbar;
}

function serializeTopLevelBlocks(editor: Editor): string[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  return editor.state.doc.content.content.map((node) => {
    const container = document.createElement("div");
    container.append(serializer.serializeNode(node));
    return persistedImageHtml(container.innerHTML);
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
  onInsertImage,
  resolveImageSrc,
  documentMode,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  const onBlockHtmlChangeRef = useRef(onBlockHtmlChange);
  const lastPropHtmlRef = useRef<string | null>(null);
  const lastRenderedHtmlRef = useRef<string | null>(null);
  const lastEmitRef = useRef<string | null>(null);
  const lastBlockHtmlRef = useRef<string | null>(null);
  const documentModeRef = useRef(documentMode);
  const imageGroupViewsRef = useRef(new Map<string, Set<() => void>>());
  const selectedDocumentImageRef = useRef<{ groupId: string; imageId: string } | null>(null);
  const [pendingImageDelete, setPendingImageDelete] = useState<{
    componentId: string;
    imageId: string;
  } | null>(null);
  const documentModeEnabled = documentMode !== undefined;
  const registerInsertImageGroup = documentMode?.registerInsertImageGroup;
  const registerInsertImageGroupAt = documentMode?.registerInsertImageGroupAt;
  const registerPaginator = documentMode?.registerPaginator;
  const [imageGroupController] = useState<DocumentImageGroupController>(() => ({
      getGroup: (id) => documentModeRef.current?.imageGroups.find((group) => group.id === id),
      getImageSrc: (file) => documentModeRef.current?.imageSrc(file),
      getSelectedImageId: (groupId) =>
        selectedDocumentImageRef.current?.groupId === groupId
          ? selectedDocumentImageRef.current.imageId
          : "",
      createGroup: () => {
        const mode = documentModeRef.current;
        if (!mode) return null;
        const id = crypto.randomUUID();
        mode.onCreateImageGroup(id);
        return id;
      },
      onAddImages: (id) => documentModeRef.current?.onAddImages(id),
      onOpenImage: (componentId, imageId, file) =>
        documentModeRef.current?.onOpenImage(componentId, imageId, file),
      onRemoveImage: (componentId, imageId) =>
        {
          if (
            selectedDocumentImageRef.current?.groupId === componentId &&
            selectedDocumentImageRef.current.imageId === imageId
          ) {
            selectedDocumentImageRef.current = null;
          }
          documentModeRef.current?.onRemoveImage(componentId, imageId);
        },
      onRequestRemoveImage: (componentId, imageId) =>
        setPendingImageDelete({ componentId, imageId }),
      onMoveImage: (params) => documentModeRef.current?.onMoveImage(params),
      onRemoveGroup: (id) => documentModeRef.current?.onRemoveImageGroup(id),
      onResizeGroup: (id, rect) =>
        documentModeRef.current?.onResizeImageGroup(id, rect),
      onSetImageFrame: (componentId, imageId, frame) =>
        documentModeRef.current?.onSetImageFrame(componentId, imageId, frame),
      onSelectImage: (groupId, imageId) => {
        selectedDocumentImageRef.current = imageId ? { groupId, imageId } : null;
      },
      getScale: () => documentModeRef.current?.scale ?? 1,
      onActivateBlankLine: (anchor) => documentModeRef.current?.onActivateBlankLine?.(anchor),
      registerView: (id, render) => {
        const views = imageGroupViewsRef.current.get(id) ?? new Set<() => void>();
        views.add(render);
        imageGroupViewsRef.current.set(id, views);
        return () => {
          views.delete(render);
          if (views.size === 0) imageGroupViewsRef.current.delete(id);
        };
      },
    }));
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
    ProjectImage.configure({ allowBase64: true }),
    ...(documentModeEnabled
      ? [
          createDocumentImageGroupExtension(imageGroupController),
          createBlankLineImageGroupInsertExtension(imageGroupController),
          createDocumentPaginationExtension(),
        ]
      : []),
  ], [documentModeEnabled, imageGroupController, placeholder]);
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
    content: editorImageHtml(html.trim() ? html : "<p></p>", resolveImageSrc),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        class: "tiptap-editor",
        role: "textbox",
      },
      handleDoubleClick(view, position) {
        const resolved = view.state.doc.resolve(position);
        for (let depth = resolved.depth; depth > 0; depth -= 1) {
          if (!resolved.node(depth).isTextblock) continue;
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, resolved.start(depth), resolved.end(depth)),
            ),
          );
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: editorInstance }) => {
      const rendered = editorInstance.getHTML();
      const next = persistedImageHtml(rendered);
      if (next === lastEmitRef.current) return;
      lastRenderedHtmlRef.current = rendered;
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
    documentModeRef.current = documentMode;
    imageGroupViewsRef.current.forEach((views) => views.forEach((render) => render()));
  }, [documentMode]);
  useEffect(() => {
    if (!editor || !documentModeEnabled) return;
    registerInsertImageGroup?.(() => {
      insertImageGroupAtDocumentEnd(editor, imageGroupController);
    });
    registerInsertImageGroupAt?.((position) => {
      insertImageGroupAtBlankLine(editor, imageGroupController, position);
    });
    registerPaginator?.((options, onComplete) =>
      paginateDocument(editor, options, onComplete));
    return () => {
      registerInsertImageGroup?.(null);
      registerInsertImageGroupAt?.(null);
      registerPaginator?.(null);
    };
  }, [
    documentModeEnabled,
    editor,
    imageGroupController,
    registerInsertImageGroup,
    registerInsertImageGroupAt,
    registerPaginator,
  ]);
  useEffect(() => {
    if (!editor) return;
    const content = editorImageHtml(html.trim() ? html : "<p></p>", resolveImageSrc);
    if (content === lastRenderedHtmlRef.current) return;
    editor.commands.setContent(content, { emitUpdate: false });
    lastRenderedHtmlRef.current = editor.getHTML();
    lastPropHtmlRef.current = html;
    lastEmitRef.current = persistedImageHtml(editor.getHTML());
    emitBlockHtml(editor, html);
  }, [editor, emitBlockHtml, html, resolveImageSrc]);

  return (
    <div
      aria-label={ariaLabel}
      className={`preshot-editor-wrap${compact ? " preshot-editor-compact" : ""}${documentMode ? " preshot-document-editor" : ""}`}
      data-editor-engine="tiptap"
      data-placeholder={placeholder}
      ref={setRootRef}
      role="group"
    >
      <div className="preshot-editor-container">
        {editor ? (
          <PreshotFormattingToolbar
            contextual={documentMode !== undefined}
            editor={editor}
            imageGroupController={documentMode ? imageGroupController : undefined}
            onInsertImage={onInsertImage}
            scale={documentMode?.scale}
          />
        ) : null}
        <EditorContent className="preshot-editor-content" editor={editor} />
        <ConfirmDialog
          cancelLabel="取消"
          confirmLabel="删除"
          onCancel={() => setPendingImageDelete(null)}
          onConfirm={() => {
            if (pendingImageDelete) {
              imageGroupController.onRemoveImage(
                pendingImageDelete.componentId,
                pendingImageDelete.imageId,
              );
            }
            setPendingImageDelete(null);
          }}
          open={pendingImageDelete !== null}
          title="删除图片？"
        />
      </div>
    </div>
  );
}