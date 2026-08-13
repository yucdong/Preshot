# Midscene 文案组件 UI Automation 最终报告

**日期：** 2026-08-11  
**模型：** `gpt-5.6-sol`（family `gpt-5`）  
**上游代理：** `http://localhost:4141/v1`  
**协议桥：** `http://127.0.0.1:4142/v1`  
**视口：** 1440 × 900  
**最终结果：** 8 / 8 场景通过

## 报告入口

最终合并报告：

`midscene_run/report/E2E-Preshot-Plan-Text-Final-2026-08-11T09-25-39-015Z.html`

该 HTML 包含全部 8 个正式通过场景的截图、AI 规划、定位、动作与确认轨迹。原始证据位于：

`test-results/midscene/`

两个目录均为本机测试产物，已被 Git 忽略。

## 场景结果

| Case | 场景 | 结果 | 正式通过耗时 |
|---|---|---:|---:|
| M01 | 新项目、插入文案、编辑保存与清理 | 通过 | 2m 03s |
| M02 | 块类型、字号、行内格式与对齐 | 通过 | 7m 40s |
| M03 | 主题色、自定义色盘、RGB 与链接 | 通过 | 11m 56s |
| M04 | 列表、嵌套、引用与代码块 | 通过 | 7m 59s |
| M05 | 递归拆分、独立编辑、删除与撤销 | 通过 | 5m 59s |
| M06 | 排序、Resize、窄工具栏与关闭按钮 | 通过 | 9m 06s |
| M07 | 自动保存、刷新、撤销与重做 | 通过 | 7m 03s |
| M08 | PDF 导出、组件删除与项目清理 | 通过 | 5m 52s |

正式通过场景合计约 57m 38s。每个 case 都通过 UI 创建唯一 `UIAUTO-*` 项目，并在结束时通过 UI 从最近项目移除。

## 清理审计

M01–M08 的正式 `result.json` 均满足：

```json
{
  "cleanupUi": "passed",
  "cleanupError": null,
  "remainingKeys": []
}
```

没有遗留 Midscene workspace、project 或 plan storage key。失败诊断运行使用独立 Chromium context，后续正式复跑也均完成 UI 清理。

## 发现并修复的问题

### P1 — 新插入组件保存后刷新无法打开项目（高，已修复）

**Midscene 发现路径：** M07 先创建全新项目，插入文案、应用格式并左右拆分；自动保存成功。刷新后应用报错：

```text
Stored plan component 0 has unsupported v10 fields
```

**根因：** `ProjectCanvasProvider` 创建新组件时附带 runtime 字段 `y: 0`；`addComponent()` 使用对象展开将该字段保留到持久化状态。schema v10 严格重载只允许 `id/name/type/x/width/height/contentScale/textRoot`，因此拒绝 `y`。

**修复：**

- UI 新组件构造不再写入 `y`；
- `addComponent()` 作为领域边界显式投影 schema-v10 字段，防止任何 runtime/未知字段进入持久化对象；
- 新增“带非法 runtime `y` 的组件插入后被清理并可严格 reload”回归。

**验证：**

- 相关 Vitest 20 / 20 通过；
- M07 真实 UI 保存→刷新→严格重载→撤销/重做通过；
- 全仓 Vitest 468 / 468、Playwright 54 / 54 通过。

### P2 — 全仓并发 transform 下 dependency test 15 秒误超时（中，已修复）

`src/app/plan/planDependencies.test.ts` 在完整 suite 的 transform 负载下两次触及 15 秒阈值，但隔离运行约 4 秒通过。Midscene 依赖增加后模块图更重。

处理：该文件的重型依赖装配测试统一使用 30 秒阈值。最终全仓 86 files / 468 tests 通过。

## 诊断澄清

### 色盘“未变红”不是产品缺陷

初始 AI 场景要求点击色盘数学最右边界后必须得到精确 `255/0/0`。真实视觉点击落在圆边界内，得到 `255/15/15`，属于合理的近纯红，原测试期望过严。

修正后的流程：

1. 色盘视觉点击验证近纯红；
2. RGB 输入精确设为 `255/0/0`；
3. 点击应用；
4. 记录实际 DOM。

确定性证据：

```json
{
  "computedColor": "rgb(255, 0, 0)",
  "editorHtml": "<p><span style=\"color: rgb(255, 0, 0);\">颜色与链接测试</span></p>"
}
```

因此色盘和颜色应用功能通过。

## 剩余风险

### R1 — 上游代理间歇性连接失败

长时间场景中多次出现：

```text
AI call failed (attempt 1/4), retrying... Error: Connection error.
```

重试后所有正式场景均通过，桥和上游健康检查始终返回正常。当前已在 bridge 增加 3 次上游 fetch 重试，并在 Midscene 层配置 3 次模型重试。

影响：测试耗时明显增加，完整正式场景合计约 58 分钟；不适合每个 PR 必跑。

建议：本地按需或 nightly 运行；后续检查 4141 代理日志和并发/连接复用限制。

### R2 — Midscene Playwright network-idle warning

每场均出现 Midscene 提示：Playwright 缺少其期望的 post-action network idle 等价行为。当前 prompt 显式等待保存/导出状态，未造成场景失败。

### R3 — 既有非阻塞警告

- ESLint：`ThemeProvider.tsx` Fast Refresh warning，0 errors；
- Vite：主 JS chunk 约 2.4 MB，存在 >500 kB warning。

## 最终回归矩阵

| 检查 | 结果 |
|---|---:|
| Midscene AI UI 场景 | 8 / 8 通过 |
| Midscene UI cleanup | 8 / 8 通过，零残留 |
| Vitest | 86 files / 468 tests 通过 |
| Playwright | 54 / 54 通过 |
| TypeScript | 通过 |
| ESLint | 0 errors / 1 existing warning |
| Production build | 通过，存在既有 large-chunk warning |
