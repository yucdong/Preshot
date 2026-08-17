# BlockNote Canvas v14 多列设计（含 v13 迁移历史）

**状态：** 迁移已实施，旧 TipTap 编辑路径与直接依赖已移除  
**日期：** 2026-08-14  
**详细实施计划：** 会话 `plan.md`

## 已确认决策

- 新项目保存 schema v13 BlockNote JSON。
- schema v1-v12 项目完全不打开、不查看、不导出，且不修改文件。
- 使用 npm 发布版 BlockNote；当前组织镜像最高为 0.53.0，0.54.0 因镜像未同步且 npm 官方 registry TLS 失败暂未安装。
- UI 使用 `@blocknote/mantine`。
- 文字能力采用 BlockNote 原生功能，允许 H4-H6、字号等能力降级。
- 图片组是 `content: "none"` React custom block，仅保存 `groupId`。
- 图片组 metadata 独立保存在 `imageGroups`。
- 图片组允许位于顶层或作为 column 的直接子项，使用 Preshot Pointer side-menu
  手柄拖动。
- 复制图片组生成新的 group/image IDs，但复用同一图片文件和 frame/crop 数据。

## 当前实施

- `src/domain/plan/canvas/blockDocument.ts`
  - v13 便携 JSON block 契约；
  - 严格 block ID、类型、内容和 image-group 引用校验。
- `src/domain/plan/blocknote`
  - 新项目 v13 seed；
  - 旧 schema typed incompatible load；
  - v13 保存、图片导入/删除和退休清理服务。
- `src/features/plan/blocknote`
  - Mantine BlockNote editor；
  - 原生 slash menu、formatting UI 和 side menu；
  - 图片组 custom block；
  - 顶层约束、复制 reconciliation、运行时 tombstone；
  - 单张连续白色画布，内容从上到下自然增长；
  - 图片导入、查看、删除、拖动和八向 resize。
  - Enter 新建 block 不使用 `onBeforeChange(getChanges)`；图片组层级约束在
    change 后规范化，避免新 block 尚无 ID 时中断 ProseMirror 事务。
- `src/infrastructure/pdf/blockNotePdfExporter.ts`
  - 直接遍历 JSON；
  - 不经过 HTML 往返；
  - 复用图片组 crop/frame/layout。

## 运行入口

BlockNote v13 是唯一编辑画布入口，不再提供 TipTap feature flag 或动态
回滚 provider。旧 schema 项目只显示版本不兼容，不加载旧编辑器代码。

当前保存版本已升级为 schema 14 / document version 2。schema 13 会在打开时
自动迁移并立即保存；schema 1-12 继续阻止打开。

## 连续画布策略

- 编辑界面不再渲染 A4 page surface、页缝、分页角标或运行时 spacer。
- 画布保持固定 1080px 逻辑宽度，左右页面 padding 为 36px；BlockNote
  内部不再重复增加 padding，因此实际可编辑内容宽度约 1008px。
- 打开或切换项目时默认最大化 Windows 应用窗口，同时保持项目栏和助手栏
  常驻显示。专注模式仍可由用户主动开启，此时两侧栏改为浮层按需打开。
- 初次打开自动按可用宽度缩放，仅保留约 20px 工作区边距；短文档至少填满
  可视高度，长文档末尾仅保留约 20px，避免出现大面积无意义灰区。
- 页面滚动仅由中间工作区承担，不在编辑器内部创建分页滚动区。
- PDF 导出继续在 `blockNotePdfExporter` 中按 A4 独立分页；屏幕不承诺
  与 PDF 页断点所见即所得。
- 图片组读取实际 `.bn-block-content` 宽度，默认填满并左右对齐；持久化
  width/x 会被夹在该范围内，不能越过白色画布。
- 图片导入后测量原始像素宽高。批量图片保持相同 `frameHeight`，
  `frameWidth = frameHeight × sourceWidth / sourceHeight`，并保存完整原图 crop，
  因此横图、竖图都不会被拉伸。
- 图片导入始终复制到项目 `references/` 目录并生成新的顺序文件名，用户选择的
  原始图片保留在原位置，不采用 rename/move 语义。
- Ctrl+滚轮以鼠标位置为锚点在 55%-180% 间缩放整张文本画布，每档 15%；
  普通滚轮继续纵向滚动。工具栏同时提供缩小、100%、放大和适宽按钮。

## Block 操作

- 使用自定义 BlockNote `SideMenuController` 和 Drag Handle Menu。
- 支持上下插入、同级子树移动、完整子树复制、类型转换、删除/撤销、
  嵌套和取消嵌套。
- 六点手柄使用 Pointer Events，而不依赖在 CSS zoom 下失效的原生 HTML5
  drag；拖动时显示独立 fixed 插入线/嵌套高亮，松手后通过事务移动完整子树。
- 图片组除六点手柄外，也可从不属于图片、按钮或 resize handle 的灰色空白区域
  启动同一套 block Pointer 拖拽；内部图片拖动和尺寸调整不会冒泡为 block 拖动。
- `Ctrl+D` 复制当前 block，`Alt+↑/↓` 执行同级移动；Tab/Shift+Tab
  继续使用 BlockNote 原生嵌套快捷键。
- 图片组不允许使用普通缩进嵌套，但可通过 column layout 进入同一行；移动、
  复制、删除和 undo 可用。
- 普通 block 复制时移除原 ID，由 BlockNote 为整棵子树生成唯一 ID；图片组
  复制继续生成新的 group/image IDs 并复用底层图片文件。

## 多列布局

- 使用 GPL-3.0 选项的 `@blocknote/xl-multi-column@0.53.0`。
- schema 通过 `withMultiColumn` 增加 `columnList` 和 `column`。
- `/两列`、`/三列` 可创建可调整宽度的列布局。
- Pointer 拖拽到 block 左右 20% 边缘可创建/扩展 columnList。
- 图片组允许位于顶层或作为 column 的直接普通 block，仍禁止嵌套到段落、
  列表、引用或其它图片组。
- 文本与图片组自动创建同行时默认列权重为 0.75:1.25；用户可拖动列分隔线。
- JSON-to-PDF 映射保留列权重；列内容横向布局，整行作为 keep-together 单元分页。

## 原生媒体 block

- schema 注册 BlockNote 原生 `image`、`video`、`audio`。
- `uploadFile(File)` 将字节写入项目 `media/`；保存 JSON 时将运行时 data URL
  还原为相对路径，重载前再解析为 data URL。
- 支持 JPG/PNG/GIF/WebP（最大 16 MiB）、MP3/WAV/OGG/M4A（最大 64 MiB）、
  MP4/WebM/MOV（最大 128 MiB）。
- media block 可位于顶层、普通嵌套或 column 中，并复用 block 操作与拖拽。
- 删除采用 detached media tombstone，undo 恢复引用；项目退休时清理未引用文件。
- PDF 原生图片按 bitmap 输出；视频/音频输出 `[视频]` / `[音频]` 文本卡片，
  外部 HTTP URL 保留可点击链接。
- Tauri CSP 显式允许 `media-src 'self' data:`。

## 未完成收尾

- 组织镜像同步后升级 BlockNote 0.53.0 → 0.54.x。
- 增加 BlockNote block drag 的视觉 Midscene 验证。
