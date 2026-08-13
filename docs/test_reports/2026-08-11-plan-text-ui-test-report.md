# 文案组件 UI 测试报告

**日期：** 2026-08-11  
**范围：** 文案组件、画布联动、工作区、主题、布局、撤销重做、PDF  
**结论：** 现有确定性测试未发现稳定产品功能失败；Midscene 新项目旅程因运行环境未配置而未执行。

## 执行结果

| 检查 | 结果 |
|---|---:|
| 文案/画布 Playwright | 42 / 42 通过 |
| 全部 Playwright E2E | 54 / 54 通过 |
| 全部 Vitest（串行复验） | 84 files / 464 tests 通过 |
| 超时测试隔离复验 | 5 / 5 通过 |
| TypeScript | 通过 |
| ESLint | 0 errors / 1 warning |
| Production build | 通过，存在 chunk size warning |
| Midscene AI suite | 未运行：模型变量和依赖缺失 |

现场截图：`test-results/2026-08-11-plan-text-ui-current-state.png`（该目录按仓库规则不提交）。

## 已验证的文案能力

- 插入、删除、排序和 resize；
- 文本编辑与自动保存；
- 段落、H1-H6 和有效字号显示；
- 加粗、斜体、下划线、删除线和对齐；
- 无序/有序列表 marker；
- 主题色、RGB、圆形色盘、明度和立即应用；
- 链接、弹层打开/关闭和选区保留；
- 左右/上下递归拆分、删除叶、撤销；
- 窄工具栏滚动、hover 提示和关闭按钮包含关系；
- 点击卡片空白/resize chrome 取消选区；
- reload 持久化、Ctrl+Z/Ctrl+Shift+Z；
- PDF 导出完成；
- 工作区、主题和自适应布局联动。

## 问题清单

### P1 — Midscene 测试环境未就绪（阻塞）

以下变量均未配置：

- `MIDSCENE_MODEL_BASE_URL`
- `MIDSCENE_MODEL_API_KEY`
- `MIDSCENE_MODEL_NAME`
- `MIDSCENE_MODEL_FAMILY`

`@midscene/core` 和 `@midscene/web` 也尚未安装。因此无法执行方案中的 AI 用户旅程、合并 HTML 报告和“UI 新建项目后清理”的现场记录。

处理建议：用户在本机 `.env` 中配置模型变量后，再实施/运行 `test:midscene:web`。密钥不应通过聊天传递。

### P2 — 高并发负载下单测可能误超时（中）

首次将全仓 Vitest、typecheck、lint 并行运行时：

- `src/app/plan/planDependencies.test.ts`
- `uses the in-memory service outside production`
- 在显式 15 秒上限处超时。

随后：

- 隔离运行 5 / 5 通过，约 4.24 秒；
- 无其他并行负载时全仓 464 / 464 通过，约 45.23 秒。

判断：不是稳定功能失败，而是测试在高 CPU/IO 竞争下的可靠性风险。

处理建议：CI 不要将完整 Vitest 与 lint/typecheck 同机高并发执行；或者对动态 import 较重的 dependency test 提供 suite 级合理超时并记录耗时趋势。

### P3 — 生产 bundle 体积警告（中，性能风险）

生产构建成功，但 Vite 报告主 JS chunk 超过 500 kB：

- `index-*.js`: 约 2,399.69 kB，gzip 约 899.23 kB；
- Noto Sans SC Regular/Bold 各约 10.6 MB。

这不是本轮文案功能回归，但会影响首次加载和安装包体积。

处理建议：拆分 PDF/editor 等低频模块，检查字体是否应在主 Web bundle 中加载，并建立 bundle budget。

### P4 — ESLint Fast Refresh warning（低）

`src/app/theme/ThemeProvider.tsx:29`：

- `react-refresh/only-export-components`

当前为 0 errors / 1 warning，不阻塞构建。

处理建议：将非组件常量或 helper 移到独立模块。

## 未发现的稳定产品问题

在当前 seeded browser 项目和现有自动化覆盖范围内，没有发现可稳定复现的文案组件功能失败。文案相关 42 个 E2E 场景及全仓 54 个 UI 场景均通过。

## 未覆盖说明

本轮没有完成以下目标：

- 通过 UI 创建全新的真实项目；
- 使用 Midscene `aiAct` 执行 8 个新项目旅程；
- 生成 Midscene 合并 HTML 报告；
- 测试后通过 UI 移除项目并验证测试 adapter 零残留。

原因不是产品 UI 失败，而是当前 browser adapter 不支持新建项目，且 Midscene 模型/依赖未配置。实施方案见 `docs/superpowers/plans/2026-08-11-midscene-plan-text-ui-automation.md`。
