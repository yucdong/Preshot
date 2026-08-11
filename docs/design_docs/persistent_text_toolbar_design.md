# 常驻文本工具栏与缩放组件 Chrome 设计

## 状态

- 状态：已实施并验证
- 日期：2026-08-10
- 交互参考：`docs/design_refs/preshot-persistent-text-toolbar-review.html`
- 方法：`ui-ux-pro-max`，密度 9、动效 2；采用键盘可达、非 hover 依赖、可读菜单、安全定位原则
- 视觉基线：`design-system/preshot/MASTER.md`

## 问题诊断

1. 当前段落菜单宽度为 176px，项目使用固定 `h-8`。中文长标签换成两行后仍被限制在 32px，高度不足导致“可折叠一级标题”等项目互相覆盖。
2. 当前文本格式栏来自 BlockNote 的选区浮动工具栏，只有编辑/选区激活后出现，不满足每个文本框始终可见的工作流。
3. 当前关闭按钮尺寸和负偏移都直接乘画布 `scale`。实测 1.125 倍画布下按钮为 18px、偏移 -9px。虽然数值发生缩放，但它仍属于组件内部绝对定位层，受自然高度、padding 和 overflow 影响，视觉锚点不稳定。
4. BlockNote 工具栏自身为 `overflow: auto`。二级菜单已通过 portal 修复，不应回退为工具栏子元素。

## 推荐结构

每个 `PlanTextLeaf` 使用以下三层结构：

```text
TextLeaf
├─ PersistentLeafToolbar   常驻、参与屏幕布局、不导出
├─ RichTextEditorContent   只测量正文自然高度
└─ PortaledMenus           挂载 document.body，不参与叶子高度
```

组件级按钮独立于叶子：

```text
ComponentFrame
├─ ComponentChromeLayer    排序、关闭、缩放状态
└─ TextTree                叶子与正文
```

## 常驻工具栏

- 每个文本叶子顶部固定显示一条 36px 工具栏，不依赖 hover、选区或焦点。
- 默认顺序：段落类型、加粗、斜体、下划线、删除线、字号、颜色、对齐、链接、更多。
- 工具栏属于屏幕编辑 chrome，PDF 导出忽略。
- 工具栏高度计入组件屏幕自然高度；正文测量必须排除工具栏，避免把 chrome 当作 PDF 文本高度。
- 没有选区时，命令作用于当前插入点或后续输入；有选区时作用于选区。
- 非活动叶子的工具栏保持可见，但使用弱化背景；活动叶子用 cyan 边框/焦点环，不改变尺寸。

### 响应式密度

使用叶子容器查询，而不是视口媒体查询：

- `>= 420px`：完整单行工具栏。
- `280–419px`：段落标签缩短，隐藏右对齐/嵌套等低频按钮并收进“更多”。
- `< 280px`：段落只显示 `T/H1/H2` 图标；保留 B/I/U、字号、颜色、更多，不产生横向滚动。
- 低频能力始终可从“更多”菜单访问，不因宽度消失。

## 段落菜单

- 通过现有 viewport-aware portal 挂载到 `document.body`。
- 宽度从 176px 增至 220px。
- 每项使用三列：`22px 图标 / 标签 / 16px 勾选`。
- 使用 `min-height: 36px`，不使用固定高度。
- 标签 `white-space: nowrap`，字号 12px，行高 20px。
- 最大高度 `min(420px, 100vh - 16px)`，菜单自身滚动。
- 靠近底边自动翻到触发器上方；四边保持至少 8px 安全距。
- 键盘支持上下移动、Enter 应用、Escape 关闭并返回触发器。

## 关闭按钮

推荐改成组件级 screen-space chrome：

- 锚点为 `ComponentFrame.getBoundingClientRect()` 的右上角。
- 按钮放在外框内部 `4–6px`，不再使用 `right/top: -8 * scale` 的负偏移。
- 视觉尺寸随画布缩放做有界变化：`clamp(18px, 18px * scale, 22px)`。
- 每次组件 ResizeObserver、画布缩放或滚动时更新锚点。
- 自然高度变化只移动锚点，不参与正文测量。
- 按钮使用 graphite；hover/focus 切换 danger，并保留 `aria-label` 与 2px 焦点环。

该方案同时解决“位置不对”和“缩放变化不稳定”：按钮跟随外框实际 rect，而不是推导内部 padding 后的位置。

## 状态与动效

- 工具栏常驻，无进入/退出动画。
- 菜单 120–160ms opacity + translateY(2px)，reduced motion 下取消。
- 叶子激活仅改变边框/背景，不改变工具栏或正文尺寸。
- 禁止宽高动画，避免文本测量和保存循环。

## 实施路径

1. 从 `PreshotFormattingToolbar` 提取可复用命令模型与 `PersistentLeafToolbar`。
2. 在 `TextLeafEditor` 中常驻渲染工具栏，保留每个 BlockNote editor 自己的 selection state。
3. 移除 `FormattingToolbarController` 的浮动显示职责；保留 BlockNote 编辑器本体。
4. 将段落菜单改为 220px、内容高度、单行标签，并补键盘 roving focus。
5. 把组件关闭按钮移到独立 `ComponentChromeLayer`，以 frame rect 定位。
6. 更新自然高度计算：屏幕组件高度包含 toolbar；PDF/文本 measurement 只读取正文。
7. 验证单叶、左右/上下/嵌套叶子以及 72%–125% 画布缩放。

## 验收标准

1. 每个文本框无需 hover 即可看到格式工具栏。
2. 所有段落类型标签无换行、重叠或裁切。
3. 最窄允许叶子没有水平滚动，所有命令仍可从“更多”访问。
4. 段落、字号、颜色和链接菜单均跳出工具栏裁切边界。
5. 关闭按钮在组件缩放、自然高度变化、滚动和画布缩放后仍锚定右上角。
6. 工具栏不进入 PDF，且不会污染正文高度测量。
7. 鼠标、键盘和屏幕阅读器均可完成核心格式操作。
8. 主题颜色和自定义 RGB 必须实际写入当前选区；测试读取编辑器 HTML/CSS 样式，并在自动保存后重载确认颜色仍存在。

## 设计验证

- 交互参考稿中选中“35mm 人像写真”并应用功能青后，DOM 写入 `color="#0891b2"`，浏览器计算颜色为 `rgb(8, 145, 178)`。
- 参考稿同时更新颜色按钮下划线和状态文本 `已应用：#0891B2`；色板关闭后正文颜色继续保留。
- 生产 Playwright 覆盖主题色完整指针点击、自定义 RGB `#C2385C`、自动保存与重载持久化，相关测试通过。
- 960×720、72% 画布缩放下，窄工具栏 `scrollWidth === clientWidth`，页面无横向溢出；关闭按钮保持 `18×18px` 屏幕尺寸并位于外框右上安全区。
- 段落菜单宽 220px，项目标签使用单行布局；展开时每项高度 36px，不再出现“可折叠一级标题”等中文标签重叠。
- 每个文案叶子现在始终显示独立格式栏；窄叶子保留段落、B/I/U、字号、颜色、链接和“更多格式”，对齐/嵌套从 portal More 面板访问。
- 关闭按钮使用固定 `18×18px` screen-space 尺寸，中心锚定组件外框右上角，允许 1px 边框容差，不再乘画布 scale。
- `screenHeightPoints` 只驱动画布运行时外框；纯正文 `heightPoints` 继续驱动持久化、分页和 PDF，工具栏不会进入导出或项目 schema。
- 参考图片改为并发加载、一次性提交比例，避免文本运行时测量中断顺序图片加载。
- 最终验证：84 个 Vitest 文件 / 461 测试，47 个 Playwright 测试，TypeScript 与生产构建通过；ESLint 仅保留既有 ThemeProvider Fast Refresh warning。
