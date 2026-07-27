# Preshot

Preshot 是一个面向摄影前期策划的桌面应用。它将用于整理参考样图、规划文案、
组织自由画布，并把完整策划导出为 PDF。

当前版本是 **Windows 优先的工程底座**：已经包含 React/Tauri 应用壳、领域边界、
测试体系、Windows 初始化脚本和架构文档，但尚未实现图片导入、画布编辑、项目保存
或 PDF 导出。

## 技术栈

- React 19、TypeScript、Vite
- Tauri v2、Rust
- Tailwind CSS
- Konva.js、react-konva（后续画布能力）
- pdf-lib（后续 PDF 导出）
- Vitest、React Testing Library、Playwright
- pnpm

## Windows 前置条件

1. Windows 10 1803 或更高版本
2. Node.js LTS（建议 22 或更高）
3. pnpm 10.15.0
4. Rust stable MSVC 工具链
5. Visual Studio 2022 Build Tools，并勾选 **Desktop development with C++**
6. Microsoft Edge WebView2 Runtime

安装 pnpm：

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

若 Corepack 因网络环境不可用，可运行：

```powershell
corepack disable
npm install --global pnpm@10.15.0
```

安装 Rust：

```powershell
winget install --id Rustlang.Rustup --exact
```

## 初始化

在仓库根目录运行：

```powershell
.\init.ps1
```

脚本会检查 Node.js、pnpm、Rust、Cargo、Visual C++ Build Tools 和 WebView2，
随后安装项目依赖。端到端测试使用 Windows 自带的 Microsoft Edge。

## 启动

启动桌面应用：

```powershell
pnpm tauri:dev
```

只启动浏览器中的前端开发服务器：

```powershell
pnpm dev
```

如果系统 PATH 中存在其他同名 `link.exe`，请从 Visual Studio 的
**Developer PowerShell for VS 2022** 中运行 Tauri 或 Cargo 命令。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```

## 构建 Windows 安装包

```powershell
pnpm tauri:build
```

产物位于 `src-tauri\target\release\bundle`。首次构建会下载并编译 Rust
依赖，耗时通常长于后续构建。

## 项目文档

- [AGENTS.md](AGENTS.md)：仓库结构和贡献约束
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：架构边界和扩展方式
- [docs/TESTING.md](docs/TESTING.md)：测试策略和命令
- [设计规格](docs/superpowers/specs/2026-07-27-desktop-foundation-design.md)
