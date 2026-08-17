# Block 操作控制设计

状态：已实施  
交互稿：`docs/design_refs/preshot-block-operations-controls-demo.html`

## 官方 API 对应

设计基于 BlockNote 官方
[Manipulating Content](https://www.blocknotejs.org/docs/reference/editor/manipulating-content)
和
[Block Side Menu](https://www.blocknotejs.org/docs/react/components/side-menu)：

| 能力 | BlockNote API | Preshot 控制 |
| --- | --- | --- |
| 读取结构 | `editor.document`、`getBlock`、`getPrevBlock`、`getNextBlock`、`getParentBlock`、`forEachBlock` | 菜单标题显示类型、层级和父级 |
| 插入 | `insertBlocks` | 左侧 `+`、菜单“在上方/下方插入” |
| 修改/转换 | `updateBlock` | “转换为”子菜单 |
| 删除 | `removeBlocks` | 危险色“删除”，完成后提供撤销提示 |
| 替换 | `replaceBlocks` | 后续模板/组合 block 操作 |
| 移动 | `insertBlocks`、`removeBlocks`、`transact` | 菜单快捷箭头执行同级子树重排，`Alt+↑/↓` 同步调用；手柄使用 Pointer Events 在缩放画布中执行 before/after/inside 放置 |
| 嵌套 | `canNestBlock`、`nestBlock`、`canUnnestBlock`、`unnestBlock` | 菜单缩进/减少缩进、`Tab/Shift+Tab` |

## 当前项目约束

- `imageGroup` 不支持普通缩进嵌套；可作为顶层 block 或 column 的直接子项。
  “增加缩进”仍禁用，并通过左右边缘拖放进入列布局。
- 复制普通 block 时复制完整子树并重新生成所有 block ID。
- 复制 `imageGroup` 时继续调用 `ImageGroupBlockController.cloneGroup`，生成新的
  group/image IDs，但复用底层图片文件。
- 删除图片组继续依赖现有 tombstone 机制，允许 BlockNote undo 恢复；文件只在
  项目退休清理阶段删除。
- 移动父 block 时必须连同完整 children 子树移动，不能拆散层级。
- 菜单上移/下移不会自动改变嵌套层级；BlockNote 原生
  `moveBlocksUp/moveBlocksDown` 可能进入/退出 children，因此菜单使用事务内
  remove + relative insert 实现同级重排。
- BlockNote 0.53 原生 HTML5 drag 在 Preshot 的 CSS `zoom` 画布下无法可靠提交
  ProseMirror drop；生产手柄改用 6px 阈值的 Pointer Events，并用独立 fixed
  overlay 显示 before/after 插入线或 inside 容器高亮。
- 删除父 block 时默认删除完整子树，并在菜单中显示子 block 数量。

## 控制器样式

### 左侧控制条

- hover/focus 当前 block 时显示，两个按钮均为 18×18 逻辑像素。
- 控制条总宽 36px，正好使用页面左侧 36px padding；左边缘不得越过白色
  画布，右边缘不得进入正文区域。
- 控制条属于画布 zoom 树，按钮尺寸与页面同比例缩放，不使用固定屏幕像素补偿。
- `+`：直接在当前 block 下方插入段落；点击箭头打开完整插入菜单。
- 六点拖拽手柄：拖动 block；单击打开操作菜单。
- 控制条不覆盖正文，使用 BlockNote `SideMenuController` 定位。

### 操作菜单

- 宽 248px，深色浮层，与图片组工具条保持一致。
- 顶部显示 block 类型、层级和子 block 数。
- 第一行四个 36×32px 快捷按钮：上移、下移、减少缩进、增加缩进。
- 主菜单：在上方插入、在下方插入、复制、转换为、删除。
- 删除项放在底部分隔区，使用危险色；操作后 toast 提供“撤销”。
- 不可执行操作保留位置但禁用，并用 tooltip 说明边界或 schema 原因。

### 嵌套反馈

- 每一级缩进 28px。
- hover 当前层级时显示低对比度竖向结构线。
- 拖动时区分三种目标：上方、下方、作为子 block。
- “作为子 block”使用青色容器高亮；普通排序使用青色 2px 插入线。

## 键盘与可访问性

- `Alt+↑/↓`：移动当前 block。
- `Tab/Shift+Tab`：增加/减少缩进。
- `Ctrl+D`：复制当前 block。
- `Delete` 只在 block 控制菜单获得焦点时删除，避免破坏文本编辑。
- `Escape` 关闭子菜单和操作菜单，并把焦点返回拖拽手柄。
- 所有图标按钮都有中文 `aria-label`、可见 focus ring 和禁用原因。

## 验证范围

- 普通 block 插入、复制、转换、删除。
- 父 block 连同完整子树上下移动。
- 嵌套/取消嵌套及首尾边界禁用。
- 图片组禁止普通嵌套，但允许顶层/列内移动、复制和删除/撤销。
- 菜单键盘导航、Escape 焦点返回和快捷键。
- JSON 持久化后 children 层级、唯一 block ID 与 image-group 引用完整。

## 已实施文件

- `src/features/plan/blocknote/blockOperations.ts`
- `src/features/plan/blocknote/BlockOperationsMenu.tsx`
- `src/features/plan/blocknote/PreshotBlockSideMenu.tsx`
- `src/features/plan/blocknote/BlockNoteDocumentEditor.tsx`
- `src/features/plan/blocknote/blockOperations.test.ts`
- `e2e/blocknote-v13.spec.ts`
