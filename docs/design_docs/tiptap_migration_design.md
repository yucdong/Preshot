# TipTap 编辑器迁移设计

## 状态

- 状态：生产迁移已完成并通过完整验证矩阵
- 日期：2026-08-10
- POC：`docs/design_refs/preshot-tiptap-editor-demo.html`
- 拆分 POC：`docs/design_refs/preshot-tiptap-split-editor-demo.html`
- 目标版本：TipTap `3.29.2`
- 上游：`https://github.com/ueberdosis/tiptap`
- 许可证：MIT；本方案不依赖付费 Pro Extensions

生产实现：`src/features/plan/TiptapRichTextEditor.tsx`。BlockNote、Mantine editor styles 与 `react-colorful` 已移除；圆形 HSV 色盘由 Preshot 自有 React 组件实现。

## 目标

将 `RichTextEditor` 的 BlockNote 内核替换为 TipTap，同时保持：

1. schema v10 与 `PlanTextLeaf.html` 不变；
2. 每个文本叶子的常驻格式工具栏视觉基本不变；
3. 段落、字号、颜色、链接弹层继续使用 viewport-aware portal；
4. 自动保存、撤销/重做、递归拆分、自然高度和 PDF 输出语义不变；
5. 现有项目 HTML 无需数据迁移即可打开。

拆分 POC 直接复用 schema-v10 的递归 `leaf` / `split` 语义。每个叶子创建独立 TipTap editor；`columns` 与 `rows` 父节点只负责等分几何和 10px 间距。拆分保留第一叶内容、创建第二叶，删除叶子后由同级节点填满剩余区域。

## 为什么选择 TipTap

- TipTap 与 BlockNote 都建立在 ProseMirror 上，选区、事务和文档树模型相近。
- TipTap 是 headless，现有 Preshot 工具栏不需要适配 Mantine 或覆盖 BlockNote UI。
- 官方 `TextStyle`、`Color`、`FontSize` 直接输出 PDF 解析器已支持的内联 HTML：
  - `<span style="color: #0891B2">`
  - `<span style="font-size: 14px">`
- 官方 Link、TextAlign、Table、TaskList 扩展可以按能力逐项启用。
- React API 提供 `useEditor`、`EditorContent`、`useEditorState`；可以让 toolbar 只订阅 active state，避免整个编辑器反复重渲染。

## 不变边界

`RichTextEditor` 的公共接口保持不变：

```ts
interface RichTextEditorProps {
  html: string;
  onChange(html: string): void;
  ariaLabel: string;
  placeholder?: string;
  compact?: boolean;
  rootRef?: React.Ref<HTMLDivElement>;
  onBlockHtmlChange?(sourceHtml: string, blocks: string[]): void;
}
```

领域与基础设施不依赖 TipTap：

```text
PlanTextLeaf.html
  -> RichTextEditor adapter
  -> TipTap/ProseMirror
  -> getHTML()
  -> existing autosave / PDF parser
```

## 依赖方案

生产迁移使用统一版本 `3.29.2`：

```powershell
pnpm add @tiptap/core@3.29.2 @tiptap/pm@3.29.2 `
  @tiptap/react@3.29.2 @tiptap/starter-kit@3.29.2 `
  @tiptap/extension-placeholder@3.29.2 `
  @tiptap/extension-text-style@3.29.2 `
  @tiptap/extension-text-align@3.29.2 `
  @tiptap/extension-table@3.29.2 `
  @tiptap/extension-task-list@3.29.2 `
  @tiptap/extension-task-item@3.29.2
```

`StarterKit` v3 已包含 Link 与 Underline，不重复注册单独扩展。Link 通过 `StarterKit.configure({ link: ... })` 配置。

迁移完成并通过完整矩阵后移除：

```powershell
pnpm remove @blocknote/core @blocknote/mantine @blocknote/react
```

## Extension 配置

```ts
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: {
      openOnClick: false,
      defaultProtocol: "https",
    },
  }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Placeholder.configure({ placeholder }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
];
```

只启用 PDF 和现有 UI 能可靠处理的节点。图片仍由 Preshot reference component 管理，不放进富文本 editor。

## HTML 兼容策略

### 直接兼容

以下现有 HTML 可由 TipTap 直接解析并重新输出：

- `p`, `h1`–`h6`；
- `strong`, `em`, `u`, `s`；
- `ul`, `ol`, `li`；
- `blockquote`, `pre`, `code`；
- `a[href]`；
- `span style="font-size/color"`；
- `table`, `thead`, `tbody`, `tr`, `th`, `td`（启用 TableKit 后）。

### 需要兼容夹具验证

BlockNote 可能输出额外 `data-*`、class 或 details/checklist 包装。迁移前建立真实 fixture corpus：

1. 从测试和浏览器 seed 收集所有当前 HTML；
2. TipTap `setContent(html)` 后读取 `getHTML()`；
3. 比较语义，而不是比较字符串：文本、块序列、marks、链接、表格与列表；
4. 对 TipTap 不识别的包装，在 adapter 入口做 DOMParser 规范化；
5. 不修改 schema，不批量重写项目文件；仅在用户实际编辑后保存 TipTap 规范化 HTML。

## 顶层块序列化契约

当前 `onBlockHtmlChange` 依赖 BlockNote `blocksToHTMLLossy()`。TipTap 替代方案直接使用 ProseMirror schema：

```ts
import { DOMSerializer } from "@tiptap/pm/model";

function serializeTopLevelBlocks(editor: Editor): string[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const document = editor.view.dom.ownerDocument;

  return editor.state.doc.content.content.map((node) => {
    const wrapper = document.createElement("div");
    wrapper.append(serializer.serializeNode(node));
    return wrapper.innerHTML;
  });
}
```

每个顶层 ProseMirror node 对应一个分页块。生成号沿用当前 generation ref，避免异步旧结果覆盖新内容。

## DOM 测量迁移

移除对以下 BlockNote 结构的依赖：

- `.bn-editor`；
- `.bn-block-group`；
- `[data-node-type="blockOuter"]`；
- `.bn-toolbar`。

TipTap 渲染时为顶层节点增加稳定测量属性：

```ts
const MeasuredParagraph = Paragraph.extend({
  renderHTML({ HTMLAttributes }) {
    return ["p", { ...HTMLAttributes, "data-editor-block": "true" }, 0];
  },
});
```

Heading、列表、blockquote、code block、table 同样输出 `data-editor-block="true"`。测量 hook 只读取：

```css
.tiptap-editor > [data-editor-block="true"]
```

常驻 toolbar 仍通过 `screenHeightPoints` 只影响运行时 frame；`heightPoints` 与 block heights 只测正文，继续服务持久化和 PDF。

## UI 命令映射

| 当前能力 | TipTap 命令 |
| --- | --- |
| 段落 | `setParagraph()` |
| H1–H6 | `setHeading({ level })` |
| 加粗 | `toggleBold()` |
| 斜体 | `toggleItalic()` |
| 下划线 | `toggleUnderline()` |
| 删除线 | `toggleStrike()` |
| 字号 | `setFontSize("14px")` |
| 文字颜色 | `setColor("#0891B2")` |
| 左/中/右对齐 | `setTextAlign(...)` |
| 无序/有序列表 | `toggleBulletList()` / `toggleOrderedList()` |
| 引用 | `toggleBlockquote()` |
| 链接 | `extendMarkRange("link").setLink({ href })` |
| 清除链接 | `unsetLink()` |

所有 toolbar `pointerdown` 继续 `preventDefault()`，然后执行 `editor.chain().focus()...run()`；TipTap 会恢复 ProseMirror selection，无需项目自己保存 Selection object。

## UI 保留与变化

### 保留

- 每个文本框顶部 36px 常驻工具栏；
- graphite / paper / cyan / berry 视觉 token；
- 220px 段落菜单与单行 36px 项；
- 字号组合按钮；
- A 色条、主题色与自定义颜色；自定义面板包含圆形 HSV 色盘、明度滑条和严格的 0–255 整数 RGB 输入；
- responsive More portal；
- 固定 18px 组件关闭按钮，放入组件右上角内部槽位；
- 视口安全距、翻转与 portal 层级。

### 组件右上角关闭槽

- 关闭按钮位于组件边框内部，不再使用负 `top/right` 悬挂到外框之外。
- 常驻工具栏右侧预留 34px screen-space 槽位，18px 关闭按钮在该槽位中居中。
- 预留空间只占工具栏右端，不新增整条 header；正文编辑区仍使用完整组件宽度。
- 关闭按钮使用 graphite 背景，hover/focus 切换 danger，并保留 2px 可见焦点环。
- 容器查询计算可见格式命令时必须扣除该槽位；溢出的低频命令进入“更多格式”。

### 明确变化

- 删除 BlockNote/Mantine DOM 与样式类；
- BlockNote 斜杠菜单、块 side menu、块拖拽不自动保留；
- “可折叠标题”需要自定义 `details/summary` node，第一阶段菜单显示禁用或移除；
- TipTap 自身无 UI，这些行为均由 Preshot 组件负责。

## 分阶段实施

### Phase 1：兼容 adapter 与纯函数

- 安装 TipTap 依赖但不切换 UI；
- 建立 extension set；
- 添加旧 HTML round-trip fixture；
- 实现顶层块序列化；
- 将测量 hook 改为 editor-neutral `[data-editor-block]`；
- 保持 BlockNote editor 运行，TipTap 只在测试中解析 fixture。

验收：所有 fixture 语义 round-trip；PDF parser 无变化。

### Phase 2：替换 RichTextEditor 内核

- `useCreateBlockNote` -> `useEditor`；
- `BlockNoteView` -> `EditorContent`；
- hydration 使用 `setContent(html, { emitUpdate: false })`；
- `onUpdate` 使用 `getHTML()`；
- toolbar active state 使用 `useEditorState`；
- 保留当前 portal 与颜色组件。

验收：组件测试、格式 Playwright、自动保存无 hydration echo。

### Phase 3：块能力与测量

- 启用 TableKit、TaskList、TaskItem；
- 所有顶层 node 增加 `data-editor-block`；
- 切换 `onBlockHtmlChange` 到 DOMSerializer；
- 验证长文拆分、递归叶子自然高度和 PDF。

验收：分页、窄叶子、PDF parity 全部通过。

### Phase 4：清理 BlockNote

- 删除 BlockNote imports、样式与 jsdom shims；
- 删除 `.bn-*` CSS；
- 移除三个 BlockNote packages；
- 更新架构、测试文档和 featurelist。

## 测试矩阵

### 组件

- 空/非空 HTML hydration 不触发 `onChange`；
- 外部 HTML 更新使用 `emitUpdate: false`；
- 常驻 toolbar 始终可见；
- active/mixed formatting 状态正确；
- Escape 与键盘菜单完整；
- compact reference editor 可访问。

### HTML 兼容

- H1–H6、列表、引用、代码、任务列表、表格；
- 嵌套 bold/italic/underline/strike；
- 字号 + 颜色同一 span；
- 链接与普通颜色；
- BlockNote fixture -> TipTap -> PDF parser 语义相同。

### Playwright

- 每个叶子一个常驻 toolbar；
- 段落、字号、颜色、链接 popup；
- 主题色、自定义 RGB 实际写入并重载保留；
- responsive More 中对齐/嵌套；
- 递归拆分、窄叶子、自然高度；
- autosave、undo/redo、PDF 导出。

## 回滚策略

在 Phase 1–3 保留同一个 `RichTextEditorProps`，并用内部 feature flag 选择 adapter：

```ts
const EditorImplementation = tiptapEnabled
  ? TiptapRichTextEditor
  : BlockNoteRichTextEditor;
```

不改 schema、不迁移文件，因此关闭 flag 即可回滚。只有 Phase 4 完整矩阵通过后才删除 BlockNote。

## POC 范围

交互 demo 使用实际 TipTap `3.29.2` ESM 包，验证：

- H1–H6、段落、列表、引用；
- bold/italic/underline/strike；
- FontSize、Color、TextAlign、Link；
- 当前 Preshot 常驻工具栏视觉；
- HTML 实时输出；
- 颜色写入 HTML 与浏览器计算色双重证明。

POC 中“可折叠标题”明确显示为自定义节点，不伪装已支持。
