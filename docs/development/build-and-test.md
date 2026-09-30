# Build and test

[Documentation index](../README.md)

Install Node.js 22+, pnpm 10, Rust MSVC x64, Visual Studio 2022 Build Tools with
**Desktop development with C++**, and Windows SDK. WebView2 is required to run.

```powershell
.\init.ps1
pnpm install --frozen-lockfile
pnpm tauri:dev
```

`pnpm dev` runs only the browser frontend. Native persistence, the global
library, and Windows capture require the desktop app. Browser fixtures inject
disposable adapters and do not represent native disk persistence.

```powershell
pnpm build
pnpm tauri build --no-bundle --target x86_64-pc-windows-msvc
pnpm production:build
```

These build frontend assets, a release EXE, and a checked MSI respectively.
See [Windows installer](../release/windows-installer.md) for signing/paths.
The Tauri wrapper resolves the default Cargo location if PATH is stale.

| Command | Coverage |
| --- | --- |
| `pnpm docs:check` | Required docs, language policy, links, stale references |
| `pnpm i18n:check` | Chinese/English resource parity |
| `pnpm lint` / `pnpm typecheck` | Static code checks |
| `pnpm test` | Domain, UI, adapters, packaging |
| `pnpm test:init` | Initializer regression harness |
| `pnpm test:production-scripts` | Version, signatures, MSI, release metadata |
| `pnpm test:dev-server` | Vite watcher and Tailwind exclude generated output while retaining application and fixture styles |
| `cargo test --manifest-path src-tauri\Cargo.toml --target x86_64-pc-windows-msvc --all-features --all-targets --locked` | Full native tests |
| `pnpm test:e2e` / `pnpm test:e2e:blocknote` | Browser integration and editor workflows |
| `pnpm production:verify` | Existing-artifact verification without rebuilding/installing |

Start with the affected suite. Keep domain tests pure, UI tests accessible,
and mocks at platform boundaries. Use real editor history for insertion/undo.
Vitest defaults to four workers to bound editor/exporter memory pressure.
Tests own temporary projects, libraries, and injected clipboard adapters.
Never use developer data or the live clipboard unattended. Set
`PRESHOT_E2E_PORT` to avoid the user's dev server; Playwright uses headless Edge.
Playwright stores disposable output under `.preshot-build-cache/playwright`
(separate folders for the default, BlockNote and capture configurations).
Failed cases retain a screenshot and trace. Do not override output to
`test-results`: that directory contains user-maintained bug lists and evidence.
Vite ignores generated output under `.preshot-build-cache`, `test-results`,
`playwright-report`, `midscene_run`, and temporary `.production-tools-*` directories.
Dependency scanning starts from `index.html` and `e2e/fixtures/*.html` only.
Tailwind scans `src` and browser fixtures, excluding temporary documentation
fixtures. Trace HTML, recording profiles, release-test files, and documentation
must not trigger application reloads or become generated UI styles.

Install/upgrade/repair/uninstall acceptance requires a disposable Windows VM.
Static MSI inspection does not replace clean-machine acceptance.
