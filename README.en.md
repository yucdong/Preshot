<p align="center"><img src="public/preshot-mark.png" width="80" alt="Preshot logo" /></p>

# Preshot

[Chinese](README.md) | **English**

Turn ideas, reference photos, models, props, and locations into a practical
shooting plan. Preshot is a Windows desktop app with local projects and a
reusable material library. The interface supports Chinese and English.

## Features

- **Projects:** create, open, autosave, and switch between loaded projects without losing editor state.
- **Planning canvas:** text, headings, checklists, tables, images, image groups, location/model/prop cards.
- **Images:** upload, paste, embed, capture screen regions, crop, resize, and reorder.
- **Material library:** reusable images, image groups, locations, models, and props/wardrobe, with descriptions and searchable tags.
- **Export:** PDF, editable DOCX, and JPEG/PNG long images with optional splitting.
- **Workspace:** light/dark themes, language switching, focus mode, zoom, and a resizable sidebar.

## Install

Open [GitHub Releases](https://github.com/yucdong/Preshot/releases) and download
`Preshot_<version>_x64_en-US.msi`. Supported platform: **Windows 10/11 x64**.
Installation is per user under `%LOCALAPPDATA%\Programs\Preshot`. Launch from
the Start Menu; a Desktop shortcut is optional. The installer is English;
the app supports both Chinese and English.

Microsoft Edge WebView2 Runtime is required. The installer downloads it when
missing, so an initial installation may need internet access. Check the release
notes for signing and verification details; releases include a SHA-256 file
and build metadata. If no installer is published yet, build from source below.

Projects default to `%USERPROFILE%\.preshot\projects`; the global library lives
in `%USERPROFILE%\.preshot\library`. Uninstalling preserves these directories.
Back up whole directories, including their image files.

## Quick start

1. Choose **New project**, enter a parent folder and name. Parent `D:\Shoots`
   plus name `Bridge portraits` creates `D:\Shoots\Bridge portraits`.
2. Write in the document. Use `/` to add headings, lists, images, groups,
   locations, models, and prop cards.
3. Image blocks offer **Upload / Embed / Screenshot** on one row. Click
   **Screenshot**, select a screen region, and the image returns to the document.
   **Esc** cancels and lets you retry. You can also use **Win+Shift+S**, then
   **Ctrl+V** in the document.
4. Select an image or use a component's actions to **Add to material library**.
   Enter a name, description, and tags. Materials can also be created directly
   inside the library.
5. Click the intended insertion row, then open **Material library**. Insert
   entire image groups or chosen images, as a group or individual Image blocks.
   Group toolbars can also append images from the library.
6. **Export** to PDF, DOCX, or a long image. Enable automatic splitting for long
   plans. Edits autosave; **Ctrl+S** saves explicitly. Closing asks whether to save.

## Walkthrough

A Nanjing Yangtze River Bridge portrait session: create a project, plan fictional
Model A with a transparent umbrella and bubble machine, collect references,
build and reuse materials, then export the shooting plan.

![Preshot walkthrough](docs/media/preshot-demo.gif)

[Full video](docs/media/preshot-demo.mp4) · [Demo and photo credits](docs/demo/README.md) · [Installer](https://github.com/yucdong/Preshot/releases)

## Build from source

Install Node.js 22+, pnpm 10, Rust MSVC x64, Visual Studio 2022 C++ Build Tools,
and Windows SDK. In PowerShell:

```powershell
git clone https://github.com/yucdong/Preshot.git
cd Preshot
.\init.ps1
pnpm install --frozen-lockfile
pnpm tauri:dev
```

```powershell
pnpm build                 # Frontend bundle
pnpm production:build      # Validate and build EXE + MSI
```

MSIs appear in `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi`.
Local unsigned builds are marked non-publishable. See the
[installer guide](docs/release/windows-installer.md) for signing and release
verification. `pnpm dev` runs only the browser frontend; use desktop mode for
native functionality.

[Documentation index](docs/README.md) · [Build and test](docs/development/build-and-test.md) · [Release workflow](docs/release/github.md)

## License

Preshot-authored source is [MIT](LICENSE). Application distributions containing
the BlockNote XL exporters follow their GPL-3.0 terms. See
[Licensing](docs/release/licensing.md) and [Third-party notices](THIRD_PARTY_NOTICES.md).
