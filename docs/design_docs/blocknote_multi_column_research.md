# BlockNote 同行多列布局调研

状态：已实施  
日期：2026-08-17

## 结论

可以支持同一行放置“文本 block + 图片组 block”。

BlockNote 官方 `@blocknote/xl-multi-column` 扩展提供：

```text
columnList
├─ column { width }
│  └─ 普通或自定义 blocks
└─ column { width }
   └─ 普通或自定义 blocks
```

因此目标结构可以表示为：

```json
{
  "type": "columnList",
  "children": [
    {
      "type": "column",
      "props": { "width": 0.75 },
      "children": [
        { "type": "paragraph", "content": "拍摄说明……" }
      ]
    },
    {
      "type": "column",
      "props": { "width": 1.25 },
      "children": [
        { "type": "imageGroup", "props": { "groupId": "group-1" } }
      ]
    }
  ]
}
```

列宽是 `flex-grow` 权重，不要求总和等于 1；两列默认均为 1。

## 官方能力与版本

- 官方文档：
  [Document Structure - Column Blocks](https://www.blocknotejs.org/docs/foundations/document-structure#column-blocks)
- 当前组织 npm 镜像提供：
  `@blocknote/xl-multi-column@0.53.0`
- 与当前项目的 `@blocknote/core/react@0.53.0` 完全匹配。
- 主要导出：
  - `withMultiColumn(schema)`
  - `ColumnBlock`
  - `ColumnListBlock`
  - `insertColumnList(editor, numColumns)`
  - `getMultiColumnSlashMenuItems(editor)`
  - `multiColumnDropCursor`
- package 许可：
  `GPL-3.0 OR PROPRIETARY`。如果 Preshot 不以 GPL-3.0 发布，需要先确认并取得
  BlockNote 的商业许可。

## 当前 Preshot 为什么还不能直接使用

### 1. Schema 未包含列 block

`src/features/plan/blocknote/blockNoteSchema.tsx` 只注册当前受限 block 类型和
`imageGroup`，没有 `columnList` / `column`。

建议：

```ts
const baseSchema = BlockNoteSchema.create({
  blockSpecs: {
    // current specs
  },
});

export const preshotBlockNoteSchema = withMultiColumn(baseSchema);
```

Slash menu 合并 `getMultiColumnSlashMenuItems(editor)`，提供“两列”和“三列”。

### 2. 持久化契约拒绝列结构

`PRESHOT_BLOCK_TYPES` 没有 `columnList` / `column`，验证器也没有以下规则：

- `columnList.content === undefined`
- `columnList.children` 至少两项且只能是 `column`
- `column.content === undefined`
- `column.props.width` 为正数
- `column.children` 至少包含一个普通 block
- `column` 中不能再次嵌套 `columnList`

这是新的持久化能力。为防止旧版本打开后丢失列结构，建议升级到 schema 14
（或至少将 block document version 升到 2），而不是静默扩展 v13。

### 3. 图片组当前被强制为顶层

当前有两层限制：

- `blockDocument.ts`：任何非顶层 `imageGroup` 都报错。
- `BlockNoteDocumentEditor.tsx`：检测到嵌套图片组后自动移回顶层。

需要改为：

- 图片组允许处于文档顶层，或作为 `column` 的直接普通 block 子项。
- 图片组仍禁止嵌套到段落、列表、引用、图片组等普通 block 下。
- `imageGroup.children` 继续必须为空。

图片组视图已经按 `.bn-block-content.clientWidth` 约束宽度，因此进入列后可自然
适应列宽，不需要重写内部图片布局。

### 4. 当前 Pointer 拖拽需要支持左右边缘

官方扩展通过 HTML5 drag 的 left/right edge drop 创建列，但 Preshot 已因 CSS
zoom 改用 Pointer Events，不能直接依赖该 drop handler。

需要给当前 `PreshotBlockSideMenu` 增加：

- `left` / `right` drop placement；
- 目标 block 左右 20%-25% 区域显示竖向青色预览；
- 普通 block 边缘 drop：用 `replaceBlocks` 创建两列 `columnList`；
- 已在列中的 block 边缘 drop：创建新 `column`；
- 拖回上下插入线：移出 column；
- 空列自动删除；只剩一列时自动拆除 `columnList`。

图片组拖入列时，顶层约束应停在 `column`，不能继续映射到文档顶层。

### 5. PDF 当前会把 children 纵向拍平

`blockDocumentToBlocks.ts` 目前递归 `flatMap` children。即使屏幕显示两列，
PDF 仍会输出“先文本、后图片”的纵向结构。

需要新增 PDF `columns` layout block：

- 按 `column.props.width` 分配可用宽度；
- 每列独立测量文本和图片组；
- 整个 column row 高度取最高列；
- column row 作为整体分页，默认不跨页拆分；
- 图片组 frame/crop 在列宽内重新布局，但不改变保存数据。

### 6. 操作菜单需要理解列容器

- 普通 block 菜单增加“与左侧/右侧并排”。
- 列内 block 增加“移出分栏”。
- `columnList` 提供“新增列 / 删除列 / 平均分布”。
- 列数建议先限制为 2，后续最多 3。
- 逻辑最小列宽建议 280px；当前 1008px 内容区适合两列，三列只适合短文本或
  单图。

## 推荐交互

1. `/两列` 插入空的两列布局。
2. 拖动 block 到另一 block 左/右边缘，出现竖向青色放置线。
3. 松手后两者进入同一 `columnList`。
4. 列间显示 8px 可拖拽分隔手柄，实时调整 flex 权重。
5. 文本 + 图片组推荐初始比例 38:62。
6. 窄列中的图片组继续保留内部拖动、缩放、删除和查看大图能力。
7. 删除某列最后一个 block 时自动保留空段落；主动“移出分栏”后若只剩一列，
   自动恢复普通纵向 blocks。

## 不推荐方案

- **表格模拟**：BlockNote table cell 存的是 inline content，不是 block children，
  不能放入 `imageGroup`。
- **单个自定义 textImageRow block**：需要在 custom block 内重新实现富文本编辑、
  block 操作、拖拽和 JSON 转换，会失去 BlockNote 原生能力。
- **直接复制 GPL 扩展源码**：若 Preshot 不是 GPL 项目会带来许可风险。

## 实施结果

- 已选择 GPL-3.0，增加第三方 notice 和完整许可证文本。
- 已升级 schema 14 / document version 2，并自动迁移 v13。
- 已接入 `withMultiColumn`、两列/三列 slash menu 和列 resize。
- 已允许图片组作为 column 子项。
- 已扩展 Pointer left/right drop 创建同行布局。
- 已更新 JSON 校验、复制、删除、undo、autosave 和引用完整性。
- 已实现 column-aware PDF layout 和整行 keep-together 分页。
- 已覆盖文本+图片组同行、列宽调整、保存重载、v13 迁移和 PDF E2E。
