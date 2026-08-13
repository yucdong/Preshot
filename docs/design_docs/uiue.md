# Preshot UI/UE 交互需求台账

本文件是 Preshot 所有 UI/UE 交互需求的唯一汇总入口。设计稿和专题设计文档可以展开视觉方案，但已接受的交互规则必须在这里形成简明、可测试的需求，并映射到自动化测试。

## 维护规则

- 每条需求使用稳定的 `UIUE-*` ID，明确触发条件、预期结果、关闭或取消条件、响应式/缩放规则及无障碍语义。
- 新增或调整 UI/UE 时，在同一变更中同步更新本文件、实现、对应回归测试，以及受影响的 `ARCHITECTURE.md`、`TESTING.md` 和专题设计文档。
- 删除交互时不得直接删除历史约束；先标记为“已替代”，注明替代需求 ID，并更新或删除对应测试。
- 组件测试验证可访问、用户可见的局部行为；Playwright 验证跨组件工作流、几何、缩放、持久化和关闭条件；Midscene 只补充需要视觉判断的旅程，不替代确定性断言。
- 测试名称或注释应能追溯到需求 ID。需求变化导致断言变化时，必须先更新本文件，再调整测试，禁止仅放宽断言来迁就实现。

## 全局交互

### UIUE-GLOBAL-001 外点关闭

临时菜单、弹层和上下文属性栏在用户点击其触发器、面板及所属编辑目标之外时关闭。面板内部操作不触发关闭。关闭不能提交未明确确认的操作。

### UIUE-GLOBAL-002 视口与缩放

固定格式内容按明确的逻辑尺寸布局。视觉缩放时，内容、上下文控件和命中区域使用同一比例；页面级 UI 不得出现非预期横向溢出、遮挡或重叠。

### UIUE-GLOBAL-003 可访问操作

按钮、菜单、工具栏、输入框和状态必须具有稳定的角色和可访问名称。纯图标按钮提供中文名称和原生 hover title；键盘焦点可见。

## 工作区与画布

### UIUE-WORKSPACE-001 三栏工作区

左侧项目栏、中间画布和右侧助手栏组成固定高度工作区。中间画布独立滚动；项目操作固定在左栏底部，长项目列表在栏内滚动。

### UIUE-CANVAS-001 连续文档

每个 v12 项目只有一个正文 TipTap 编辑器。正文可在图片组之前、之间和之后连续编辑；图片组是文档中的原子节点，默认全宽且可在正文边界内调整组框宽高，不创建独立文案框。文案不显示卡片、输入框、独立标题框或第二层可打印区边框，白色 A4 Canvas 是唯一文字区域边界；图片组保留轻量组件边框。项目 metadata title 不单独渲染，需要可见标题时使用正文 H1/H2。

### UIUE-CANVAS-002 居中缩放

画布在中间滚动区内水平居中。使用 `Ctrl/Cmd + 滚轮` 改变画布比例时，以画布水平中轴缩放，而不是固定左边缘；纵向仍保留当前交互位置。缩放后 A4 页面中轴与可用视口中轴保持一致。

### UIUE-CANVAS-003 上下文属性栏

- 只有存在非空文字选区时才显示文字属性栏；仅放置光标或没有选中文字时不显示。
- 文本、标题、列表项、引用和代码块显示 I-beam cursor；双击其中任一文本块选中完整块，避免依赖浏览器三击。
- 选择图片组时显示图片组属性栏；文字属性栏与图片组属性栏互斥。
- 图片组属性栏提供添加图片、`− / px / +` 组级等比缩放和删除。滚轮滚动后属性栏立即收起，再次点击图片组恢复显示。
- 文字属性栏优先位于选区右上，空间不足时在视口内反向贴齐。
- 文字属性栏固定两行且不可内部滚动。第一行提供完整块类型、字号减小/当前值/增大和当前颜色；第二行提供加粗、倾斜、下划线、删除线、左/中/右对齐和减少/增加缩进。
- 工具栏必须按实际内容自适应宽度，压缩外边距、控件间距和分隔线，不保留装饰性空白。可访问名称替代可见的“层级/字号/颜色”等分组标签。
- 对齐按钮必须使用可辨识的标准文本线条图标（Lucide AlignLeft/AlignCenter/AlignRight），三者的横线位置须明显不同；缩进使用 Lucide IndentDecrease/IndentIncrease。
- 完整块类型覆盖当前启用且可作用于选区的 TipTap 节点：正文、一级至六级标题、引用、无序列表、有序列表、任务列表和代码块。表格、分隔线、图片组等结构节点走插入流程，不伪装成层级样式。
- 对齐适用于段落和标题。列表缩进必须支持增加层级和减少层级；引用支持嵌套与取消嵌套。所有命令执行后原文字选区保持可继续操作。
- 选区包含多个字号时，字号控件显示最小字号加 `+`，例如 12px/20px 显示 `12+`；辅助名称说明这是混合字号及其最小值。
- 用户对混合字号选区执行字号增加、减少或直接设置后，必须以显示的最小值为基数计算目标值，并将整个选区统一覆盖为该目标字号。操作后控件显示单一字号，不再带 `+`。
- 当前颜色按钮左侧立即复用当前色，右侧打开标准颜色；工具栏本身不平铺色块。
- Standard Colors 底部的 `More Colors…` 只是跳转入口：点击后 Standard Colors 关闭，并打开挂载到页面顶层、独立定位和独立生命周期的完整颜色选择器。More Colors 不能嵌套或依附于 Standard Colors。
- More Colors 的二维色盘必须一次可见完整 Hue 彩虹，横轴为 0–360° Hue、纵轴为 Saturation，不能只显示当前 Hue 的蓝色或其他单色渐变；右侧独立 Brightness 轴。Hue×Saturation×Brightness 必须覆盖完整 HSV/RGB 色域。
- More Colors 同时提供 R/G/B 0–255 整数输入、颜色预览和只读 HEX；色盘、Brightness、RGB 和 HEX 双向同步。Apply 提交到原选区并更新当前色，Cancel 不修改文本。
- 控件交互必须保存并恢复原文字选区；层级、字号和所有行内格式可连续应用并真实写入编辑器 HTML。
- 点击 Style 栏及其弹层以外的任何位置时都折叠旧选区并收起属性栏，包括点击同一 TipTap 文档中的其他文字或空白行；编辑器内点击保留新光标位置，编辑器外点击同时清除浏览器 Range 并取消焦点。
- 窄视口中属性栏保持两行并限制在视口内，可隐藏辅助标签但不能使用横向/纵向滚动；页面本身不产生横向溢出。

### UIUE-CANVAS-004 插入菜单

画布顶部“插入”、空白行 `+` 和页面末尾 `+` 打开同一组件菜单，当前仅包含“图片组”。点击菜单及触发器之外时菜单关闭；选择菜单项后菜单关闭并执行一次插入。页面末尾入口在插入后继续保留。

- 点击任意空白段落后，当前行对应的 A4 Canvas 左侧显示一个 24px 圆形 `+`；仅 hover 不触发。按钮在不同空白行间跟随，点击非空文本或外部区域后隐藏。
- `+` 与菜单是页面顶层 overlay，不写入 canonical `documentHtml`。滚动、画布缩放和窗口变化时保持与空白行垂直对齐。
- 从空白行插入图片组时，在该空白段落之前创建 image-group atom，原空白段落保留在图片组之后，继续承担正文输入位置。

### UIUE-CANVAS-005 图片组

图片组默认占满正文可打印宽度，不显示旧组件名称、标题或描述。四边透明热区调整单轴，四角透明热区同时调整组框宽高，且组框始终限制在正文边界内；不显示蓝色方块或条形。组框扩大且已有图片可放下时图片尺寸不变；组框缩到放不下时才统一等比缩小图片。属性栏 `− / px / +` 等比调整全部图片并保持各自宽高比，同一行放不下时自动换行。

单击图片后四边和四角透明热区可用：边缘调整单轴，角落同时调整宽高；接近同组图片宽高时吸附并显示对齐参考线。上方属性栏切换为“图片”模式，删除按钮只显示在该属性栏中，图片卡片本身不显示删除。双击打开完整原图后才显示恢复尺寸按钮；恢复同时恢复默认 frame 和完整原图 crop，然后立即关闭原图视图并将焦点返回图片。原图文件始终不变且项目只保存一个 view。

图片选择与 resize 预览/提交必须复用既有图片 DOM，禁止通过重建整组图片来刷新状态，以免闪烁或重复解码。四边热区在画布缩放后仍须保留可用的屏幕命中宽度并位于 frame 内侧，确保不会被组网格裁切。

图片组选中后仅将组背景中性加深，不改变原边框、阴影或几何尺寸，禁止绘制额外的外层选中框。单图选中后同样保持原边框、阴影和尺寸，只显示左上两位序号；删除位于图片属性栏。

### UIUE-CANVAS-006 保存与撤销

编辑后显示未保存/保存中/已保存状态，自动保存仅写入发生变化的计划。`Ctrl/Cmd+S` 立即保存；文档结构操作支持撤销/重做，刷新后恢复 canonical `documentHtml` 与图片组元数据。

### UIUE-CANVAS-007 A4 整体分页

每张 A4 页面具有独立可打印边界。所有顶层文字块和图片组都是 keep-together 块：当前页剩余空间不足时整体进入下一页，不允许跨页、拆分或落入页面间隙；前一页空白区域仍可继续输入正文。单块自身超过可打印高度时只在视图层缩放到单页，不修改 canonical HTML 或图片元数据。屏幕与 PDF 使用相同 keep-together 语义。

- 每页显示 Word 式四角标而非完整内边框：角标线臂位于正文区外，四个尖端朝向文档内侧并精确落在正文可打印边界上；左上为 `┘`、右上为 `└`、左下为 `┐`、右下为 `┌`。
- 页缝由高于 editor 的不可编辑 overlay 覆盖；点击页缝只能清除旧选区，不能放置光标或输入。键盘换行与导航跨越分页 decoration，直接进入下一页正文。

## 确定性测试映射

| 需求 | 主要回归测试 |
| --- | --- |
| UIUE-WORKSPACE-001 | `e2e/layout.spec.ts`, `e2e/workspace.spec.ts` |
| UIUE-CANVAS-001 | `e2e/canvas.spec.ts` - unrestricted document and double-click block selection |
| UIUE-CANVAS-002 | `e2e/canvas.spec.ts` - horizontally centered wheel zoom |
| UIUE-CANVAS-003 | `e2e/canvas.spec.ts` - compact property bars, block styles, mixed font size, RGB color |
| UIUE-CANVAS-004 | `e2e/canvas.spec.ts` - outside close, top insertion, and clicked blank-line image-group insertion |
| UIUE-CANVAS-005 | `PlanCanvas.test.tsx` - number badge, image-toolbar-only deletion, invisible eight-way image/group resize, source open, group scale and toolbar dismissal; `ReferenceImageLightbox.test.tsx` - reset/close/focus; `e2e/canvas.spec.ts` - toolbar deletion, no-extra-frame selection style, import, resize persistence, lightbox reset and atomic group removal |
| UIUE-CANVAS-006 | `e2e/canvas.spec.ts`, `e2e/undo-redo.spec.ts` |
| UIUE-CANVAS-007 | `e2e/canvas.spec.ts` - keep-together A4 pagination |

专题设计：`docs/design_docs/canvas_design.md`。分页交互原型：`docs/design_refs/preshot-paged-document-review.html`。图片卡片交互原型：`docs/design_refs/preshot-picture-card-review.html`。交互设计发生变化时，本台账和上述测试映射必须同时调整。
