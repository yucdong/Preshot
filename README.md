# Preshot

Preshot is a Windows-first desktop application for photography planning. The current application is not just a shell: it opens local projects, edits plans in a BlockNote 0.53 document, manages image groups and native media, and exports PDF files.

> The application UI is currently localized in Simplified Chinese. This documentation is written in English on purpose; do not treat Chinese UI copy as missing translation work unless the task is explicitly about localization.

## Current product surface

- Recent-project launcher and in-app project rail
- BlockNote v14 editor (`schemaVersion: 14`, `document.format: "preshot-blocks"`, `document.version: 2`)
- Slash menu, block drag, undo/redo, headings, lists, checklists, toggles, quotes, code blocks, tables, and dividers
- Multi-column blocks via `@blocknote/xl-multi-column@0.53.0`
- Custom image-group blocks with resize, reorder, lightbox, native import, and Windows screen capture
- Native BlockNote image, video, and audio blocks backed by project-local `media/`
- Auto-save, explicit save shortcut, theme settings, resizable shell panels, and focus mode
- A4 PDF export through `pdf-lib` plus a native save dialog

## Repository layout

- `src/app` application composition, shell, theme, and workspace provider
- `src/features` React feature surfaces, especially the BlockNote plan editor and workspace UI
- `src/domain` pure models, use cases, ports, schema validation, and shared layout logic
- `src/infrastructure` Tauri/browser adapters and PDF export wiring
- `src-tauri` Rust commands and Tauri configuration
- `docs` architecture, testing, reliability, and design documentation
- `e2e` Playwright smoke coverage
- `init.ps1` Windows prerequisite check and dependency installation

## Project and storage model

- Each project directory contains `.preshotproj` (legacy `.preshot` is still read and migrated).
- The project manifest has `schemaVersion: 1` and stores the plan JSON in `manifest.plan`.
- The active plan format is schema v14 / document v2.
- Reference image files live under `references/`.
- Native BlockNote media files live under `media/`.
- Theme and shell settings are stored in `%USERPROFILE%\.preshot\settings.json`.
- New-project picking defaults to `%USERPROFILE%\.preshot\projects`.

## Tech stack

- React 19, TypeScript, Vite
- Tauri 2, Rust
- BlockNote 0.53, Mantine 8
- Tailwind CSS 4
- `pdf-lib` + `@pdf-lib/fontkit`
- Vitest, React Testing Library, Playwright
- pnpm 10.15.0

## Windows prerequisites

1. Windows 10 version 1803 or later
2. Node.js 20.19.0+ on the 20.x line, or Node.js 22.12.0+
3. pnpm 10.15.0
4. Rust stable with the MSVC target
5. Visual Studio 2022 Build Tools with **Desktop development with C++**
6. Microsoft Edge WebView2 Runtime

Install pnpm:

```powershell
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

If Corepack is unavailable in your environment:

```powershell
corepack disable
npm install --global pnpm@10.15.0
```

Install Rust:

```powershell
winget install --id Rustlang.Rustup --exact
```

## Setup

Run the repository initializer from the repository root:

```powershell
.\init.ps1
```

The script validates Node.js, pnpm, Rust, Cargo, Visual C++ Build Tools, and WebView2, then runs `pnpm install --frozen-lockfile`.

`pnpm tauri`, `pnpm tauri:dev`, and `pnpm tauri:build` run through `scripts\tauri.ps1`, which auto-discovers Cargo in `%USERPROFILE%\.cargo\bin` when the current VS Code `PATH` has not refreshed yet. If Rust is installed elsewhere, add that Cargo directory to `PATH` and restart your terminal or editor.

If another `link.exe` shadows the Visual Studio toolchain, run Tauri or Cargo commands from **Developer PowerShell for VS 2022**.

## Commands

### Development and packaging

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the browser-only Vite development server. |
| `pnpm preview` | Preview the built web bundle. |
| `pnpm tauri` | Run the local Tauri CLI through the Windows wrapper. |
| `pnpm tauri:dev` | Start the desktop application in Tauri development mode. |
| `pnpm build` | Run the TypeScript build and Vite production build. |
| `pnpm tauri:build` | Build Windows desktop bundles. |

### Validation

| Command | Purpose |
| --- | --- |
| `pnpm lint` | Run ESLint. |
| `pnpm typecheck` | Run the TypeScript project build in type-check mode. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:init` | Run the PowerShell initializer regression harness. |
| `pnpm test:e2e` | Run the main Playwright browser-shell smoke suite. |
| `pnpm test:e2e:blocknote` | Run the focused BlockNote v14 Playwright suite. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Run the Rust unit tests. |

### Midscene and AI-assisted workflows

| Command | Purpose |
| --- | --- |
| `pnpm dev:midscene` | Start the dedicated Vite server for Midscene-driven browser tests. |
| `pnpm midscene:proxy` | Start the local Midscene Responses-API bridge. |
| `pnpm midscene:model:verify` | Verify the configured Midscene model connection. |
| `pnpm midscene:smoke` | Run the read-only Midscene smoke against a running app. |
| `pnpm test:midscene:web` | Run the serialized Midscene web suite. |
| `pnpm midscene:report:merge` | Merge Midscene HTML/text reports. |

### Maintenance

| Command | Purpose |
| --- | --- |
| `pnpm migrate:project` | Run the project-manifest migration utility. |

## Documentation

- [Contributor guide](AGENTS.md)
- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Reliability](docs/RELIABILITY.md)
- [BlockNote v14 design](docs/design_docs/blocknote_v14_design.md)
- [UI/UX contract](docs/design_docs/UI_UX_CONTRACT.md)
- [Feature status tracker](docs/design_docs/featurelist.json)

## License

Preshot's own source code is under the [MIT License](LICENSE).

Distributed application builds that include `@blocknote/xl-multi-column` use that dependency through its GPL-3.0 option, so shipped Preshot application distributions must be provided under GPL-3.0 with the corresponding source and license notices.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt).
