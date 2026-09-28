<p align="center"><img src="public/preshot-mark.svg" width="80" alt="Preshot logo" /></p>

# Preshot

**简体中文** | [English](README.en.md)

把拍摄想法、参考照片、模特、道具和地点整理成一份可执行的拍摄方案。
Preshot 是 Windows 桌面应用，项目与素材保存在本地，支持中文和英文界面。

## 功能

- **项目管理**：新建、打开、自动保存；多个已打开项目切换时保留编辑状态。
- **自由编排方案**：文字、标题、清单、表格、图片和图片组，以及地点、模特、道具与服装卡片。
- **图片与截图**：上传、粘贴、嵌入、屏幕区域截图；裁切、缩放和拖动排序。
- **素材库**：保存单张图片、图片组、地点、模特、道具与服装，按描述和关键词检索，在不同项目中复用。
- **导出**：PDF、可编辑的 Word 文档、JPEG/PNG 长图，可选择自动分割。
- **工作区**：明暗主题、中英文切换、专注模式、缩放和可调侧边栏。

## 安装

前往 [GitHub Releases](https://github.com/yucdong/Preshot/releases)，选择版本中的
`Preshot_<版本>_x64_en-US.msi`。安装包适用于 **Windows 10/11 x64**，默认安装到
`%LOCALAPPDATA%\Programs\Preshot`，从开始菜单启动；桌面快捷方式可以在安装时选择。
`en-US` 表示安装向导语言，应用内仍可自由切换中文和英文。

运行需要 Microsoft Edge WebView2 Runtime，安装向导会在缺失时下载，因此首次安装可能需要联网。
Release 同时提供 SHA-256 校验文件和构建信息；签名与验证情况以该版本说明为准。
若 Releases 尚无安装包，可按照下方步骤从源码构建。

项目默认位于 `%USERPROFILE%\.preshot\projects`，全局素材库位于
`%USERPROFILE%\.preshot\library`。卸载应用不会删除这些数据；备份时请复制完整目录。

## 快速上手

1. 点击 **新建项目**，输入项目名称和父目录。例如父目录 `D:\拍摄`、名称“南京长江大桥人像”，会创建 `D:\拍摄\南京长江大桥人像`。
2. 在文档中输入文字，用 `/` 插入标题、清单、图片、图片组、地点、模特或道具卡片。
3. 插入图片时，**上传 / 嵌入 / 截图** 在同一行。点击 **截图** 后框选屏幕区域，图片自动回到文档；按 **Esc** 可取消并重新截图。也可使用 **Win+Shift+S** 截图后，在文档中 **Ctrl+V** 粘贴。
4. 单击图片，或使用组件操作菜单，将内容 **添加到素材库**，填写名称、描述和关键词。也可在素材库中直接创建模特、地点或道具。
5. 点击要插入的位置，再打开 **素材库**。图片组可全部或部分插入，并选择“图片组”或“单张图片”；图片组工具栏也支持从素材库追加图片。
6. 用 **导出** 生成 PDF、DOCX 或长图。长图过长时勾选自动分割。编辑自动保存，也可以按 **Ctrl+S**；关闭项目时会询问是否保存。

## 操作演示

以“南京长江大桥风光人像”为例：创建项目，规划虚构模特 A、透明伞和泡泡机，收集参考图，建立并复用素材，最后导出拍摄方案。

![Preshot 操作流程](docs/media/preshot-demo.gif)

[演示说明与图片来源](docs/demo/README.md) · [完整视频与安装包](https://github.com/yucdong/Preshot/releases)

## 从源码构建

需要 Node.js 22+、pnpm 10、Rust MSVC x64、Visual Studio 2022 C++ 构建工具和 Windows SDK。
在 PowerShell 中运行：

```powershell
git clone https://github.com/yucdong/Preshot.git
cd Preshot
.\init.ps1
pnpm install --frozen-lockfile
pnpm tauri:dev
```

```powershell
pnpm build                 # 构建前端
pnpm production:build      # 检查、构建 EXE 和 MSI
```

安装包输出到 `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi`。
本地未配置签名时生成的包会标为不可公开发布；正式发布的签名与校验步骤见
[安装包说明](docs/release/windows-installer.md)。`pnpm dev` 只运行浏览器前端，完整功能请用桌面模式。

[功能文档索引](docs/README.md) · [开发与测试](docs/development/build-and-test.md) · [发布流程](docs/release/github.md)

## 许可证

Preshot 自有源码采用 [MIT](LICENSE)。包含 BlockNote XL 导出器的应用发行版遵循其 GPL-3.0 条款；
详见 [许可说明](docs/release/licensing.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。
