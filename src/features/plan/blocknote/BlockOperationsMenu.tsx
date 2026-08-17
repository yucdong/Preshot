import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronRight,
  Copy,
  Heading2,
  IndentDecrease,
  IndentIncrease,
  List,
  ListOrdered,
  Pilcrow,
  Plus,
  Quote,
  Trash2,
  Type,
} from "lucide-react";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from "@blocknote/react";
import type { ReactNode } from "react";
import {
  blockContext,
  canNestSpecificBlock,
  canUnnestSpecificBlock,
  convertBlock,
  deleteBlockOrSelection,
  duplicateBlockTree,
  insertParagraphRelativeToBlock,
  moveSpecificBlock,
  nestSpecificBlock,
  unnestSpecificBlock,
  type ConvertibleBlockType,
  type PreshotEditorBlock,
} from "./blockOperations";
import type { ImageGroupBlockController } from "./ImageGroupBlockContext";
import { preshotBlockNoteSchema } from "./blockNoteSchema";

interface BlockOperationsMenuProps {
  controller: ImageGroupBlockController;
  notify(message: string): void;
}

interface QuickActionProps {
  label: string;
  disabled: boolean;
  disabledReason: string;
  icon: ReactNode;
  onClick(): void;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: "正文",
  heading: "标题",
  bulletListItem: "项目符号",
  numberedListItem: "编号列表",
  checkListItem: "待办事项",
  toggleListItem: "折叠列表",
  quote: "引用",
  codeBlock: "代码",
  table: "表格",
  divider: "分隔线",
  imageGroup: "图片组",
};

const CONVERT_OPTIONS: Array<{
  type: ConvertibleBlockType;
  label: string;
  icon: ReactNode;
}> = [
  { type: "paragraph", label: "正文", icon: <Pilcrow size={15} /> },
  { type: "heading", label: "二级标题", icon: <Heading2 size={15} /> },
  { type: "bulletListItem", label: "项目符号列表", icon: <List size={15} /> },
  { type: "numberedListItem", label: "编号列表", icon: <ListOrdered size={15} /> },
  { type: "checkListItem", label: "待办事项", icon: <CheckSquare size={15} /> },
  { type: "quote", label: "引用", icon: <Quote size={15} /> },
];

function descendantCount(block: PreshotEditorBlock): number {
  return block.children.reduce(
    (total, child) => total + 1 + descendantCount(child),
    0,
  );
}

function QuickAction({
  label,
  disabled,
  disabledReason,
  icon,
  onClick,
}: QuickActionProps) {
  return (
    <button
      aria-label={label}
      className="preshot-block-operation-quick"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason : label}
      type="button"
    >
      {icon}
    </button>
  );
}

function DisabledMenuItem({
  children,
  reason,
}: {
  children: ReactNode;
  reason: string;
}) {
  return (
    <div
      aria-disabled="true"
      className="preshot-block-operation-disabled"
      role="menuitem"
      title={reason}
    >
      {children}
    </div>
  );
}

export function BlockOperationsMenu({
  controller,
  notify,
}: BlockOperationsMenuProps) {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor<
    typeof preshotBlockNoteSchema.blockSchema,
    typeof preshotBlockNoteSchema.inlineContentSchema,
    typeof preshotBlockNoteSchema.styleSchema
  >();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  }) as PreshotEditorBlock | undefined;

  if (!Components || !block) return null;

  const context = blockContext(editor.document, block.id);
  const childCount = descendantCount(block);
  const canMoveUp = (context?.index ?? 0) > 0;
  const canMoveDown = context !== undefined &&
    context.index < context.siblings.length - 1;
  const canNest = canNestSpecificBlock(editor, block);
  const canUnnest = canUnnestSpecificBlock(editor, block);
  const canConvert =
    block.type !== "imageGroup" &&
    block.type !== "table" &&
    block.type !== "divider" &&
    Array.isArray(block.content);

  const insert = (placement: "before" | "after") => {
    const [inserted] = insertParagraphRelativeToBlock(
      editor,
      block,
      placement,
    );
    editor.setTextCursorPosition(inserted, "start");
    notify(placement === "before" ? "已在上方插入段落" : "已在下方插入段落");
  };

  return (
    <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu preshot-block-operations-menu">
      <span data-block-operation-id={block.id} hidden />
      <Components.Generic.Menu.Label className="preshot-block-operation-label">
        <span>{BLOCK_TYPE_LABELS[block.type] ?? block.type}</span>
        <span>
          层级 {context?.depth ?? 0}
          {childCount > 0 ? ` · ${childCount} 个子 block` : ""}
        </span>
      </Components.Generic.Menu.Label>
      <div className="preshot-block-operation-quick-row">
        <QuickAction
          disabled={!canMoveUp}
          disabledReason="已经是可移动范围内的第一个 block"
          icon={<ArrowUp size={15} />}
          label="上移 block"
          onClick={() => {
            if (moveSpecificBlock(editor, block, "up")) notify("Block 已上移");
          }}
        />
        <QuickAction
          disabled={!canMoveDown}
          disabledReason="已经是可移动范围内的最后一个 block"
          icon={<ArrowDown size={15} />}
          label="下移 block"
          onClick={() => {
            if (moveSpecificBlock(editor, block, "down")) notify("Block 已下移");
          }}
        />
        <QuickAction
          disabled={!canUnnest}
          disabledReason="当前 block 已经位于顶层"
          icon={<IndentDecrease size={15} />}
          label="减少缩进"
          onClick={() => {
            if (unnestSpecificBlock(editor, block)) notify("Block 已取消嵌套");
          }}
        />
        <QuickAction
          disabled={!canNest}
          disabledReason={
            block.type === "imageGroup"
              ? "图片组必须保持顶层"
              : "前方没有可作为父级的同级 block"
          }
          icon={<IndentIncrease size={15} />}
          label="增加缩进"
          onClick={() => {
            if (nestSpecificBlock(editor, block)) notify("Block 已嵌套");
          }}
        />
      </div>
      <Components.Generic.Menu.Divider className="preshot-block-operation-divider" />
      <Components.Generic.Menu.Item
        className="preshot-block-operation-item"
        icon={<Plus size={15} />}
        onClick={() => insert("before")}
      >
        <span>在上方插入</span>
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item
        className="preshot-block-operation-item"
        icon={<Plus size={15} />}
        onClick={() => insert("after")}
      >
        <span>在下方插入</span>
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item
        className="preshot-block-operation-item"
        icon={<Copy size={15} />}
        onClick={() => {
          const inserted = duplicateBlockTree(editor, block, controller);
          if (inserted.length > 0) {
            notify(
              childCount > 0
                ? `已复制 block 与 ${childCount} 个子 block`
                : "已复制 block",
            );
          }
        }}
      >
        <span>复制 block</span>
        <span className="preshot-block-operation-shortcut">Ctrl+D</span>
      </Components.Generic.Menu.Item>
      {canConvert ? (
        <Components.Generic.Menu.Root position="right" sub={true}>
          <Components.Generic.Menu.Trigger sub={true}>
            <Components.Generic.Menu.Item
              className="preshot-block-operation-item"
              icon={<Type size={15} />}
              subTrigger={true}
            >
              <span>转换为</span>
              <ChevronRight
                aria-hidden
                className="preshot-block-operation-chevron"
                size={14}
              />
            </Components.Generic.Menu.Item>
          </Components.Generic.Menu.Trigger>
          <Components.Generic.Menu.Dropdown
            className="bn-menu-dropdown preshot-block-operations-submenu"
            sub={true}
          >
            {CONVERT_OPTIONS.map((option) => (
              <Components.Generic.Menu.Item
                className="preshot-block-operation-item"
                icon={option.icon}
                key={option.type}
                onClick={() => {
                  convertBlock(editor, block, option.type);
                  notify(`已转换为${option.label}`);
                }}
              >
                {option.label}
              </Components.Generic.Menu.Item>
            ))}
          </Components.Generic.Menu.Dropdown>
        </Components.Generic.Menu.Root>
      ) : (
        <DisabledMenuItem reason="此 block 类型不能转换">
          <Type size={15} />
          <span>转换为</span>
        </DisabledMenuItem>
      )}
      <Components.Generic.Menu.Divider className="preshot-block-operation-divider" />
      <Components.Generic.Menu.Item
        className="preshot-block-operation-item preshot-block-operation-danger"
        icon={<Trash2 size={15} />}
        onClick={() => {
          deleteBlockOrSelection(editor, block);
          notify(
            childCount > 0
              ? `已删除 block 与 ${childCount} 个子 block`
              : "已删除 block",
          );
        }}
      >
        {childCount > 0
          ? `删除 block 与 ${childCount} 个子 block`
          : "删除 block"}
      </Components.Generic.Menu.Item>
    </Components.Generic.Menu.Dropdown>
  );
}
