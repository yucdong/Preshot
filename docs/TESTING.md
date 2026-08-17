# Testing

## Principles

- Add a failing regression test before fixing a defect.
- Keep domain tests pure and fast.
- Keep component tests focused on accessible, user-visible behavior.
- Mock only platform boundaries such as Tauri `invoke`, file pickers, or browser storage.
- Use Playwright as a browser-shell smoke/integration layer rather than a replacement for unit coverage.
- Keep Midscene evidence supplementary; it does not replace deterministic assertions.
- Use the real Simplified Chinese UI strings in tests unless the change intentionally updates localization.

## Command matrix

Run commands from the repository root on Windows.

### Static checks, unit tests, and build

| Command | Purpose |
| --- | --- |
| `pnpm docs:check` | English-only repository documentation, feature-list JSON parsing, local Markdown links, and stale current-v13/old-name checks. |
| `pnpm lint` | ESLint for the TypeScript, React, and script code. |
| `pnpm typecheck` | TypeScript project build in type-check mode. |
| `pnpm test` | Vitest suite for domain, components, adapters, and utility logic. |
| `pnpm test:watch` | Vitest watch mode for local TDD. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Rust unit tests for Tauri-side commands and helpers. |
| `pnpm build` | TypeScript build plus Vite production bundle. |
| `pnpm tauri:build` | Desktop package build. |

If Visual Studio tools are not already active in the shell, use **Developer PowerShell for VS 2022** before running Rust or Tauri packaging commands.

## Preshot 0.0.1 verification

The release-hardening matrix completed on 2026-08-17:

- documentation checks passed;
- ESLint passed with zero warnings;
- TypeScript passed;
- 93 Vitest files and 480 tests passed;
- 4 PowerShell initializer tests passed;
- 51 Rust tests passed;
- 15 unified Playwright journeys passed;
- 8 focused BlockNote v14 Playwright journeys passed;
- the production web and Tauri builds passed; and
- the installer was produced as `Preshot_0.0.1_x64_en-US.msi`.

Vite still reports its advisory large-chunk warning for the production bundle.

### Browser-shell tests

| Command | Purpose |
| --- | --- |
| `pnpm test:e2e` | Main Playwright suite on `http://127.0.0.1:1420` using Microsoft Edge. |
| `pnpm test:e2e:blocknote` | Focused BlockNote v14 Playwright suite on `http://127.0.0.1:1430`. |
| `pnpm test:init` | PowerShell harness for `init.ps1` error handling and Node version boundaries. |

### Midscene and AI-assisted checks

| Command | Purpose |
| --- | --- |
| `pnpm dev:midscene` | Dedicated Vite server for Midscene-driven tests. |
| `pnpm midscene:proxy` | Start the local bridge that translates Midscene Chat Completions traffic to the Responses API. |
| `pnpm midscene:model:verify` | Verify the configured Midscene model pipeline. |
| `pnpm midscene:smoke` | Run the read-only Midscene smoke against a running app. |
| `pnpm test:midscene:web` | Serialized Midscene browser suite from `e2e-midscene/`. |
| `pnpm midscene:report:merge` | Merge Midscene text/HTML reports under `midscene_run\report`. |

## Coverage by layer

### Domain

Domain tests cover pure behavior such as:

- BlockNote v14 schema validation,
- v13-to-v14 migration,
- block nesting and image-group invariants,
- extraction of referenced `media/` files,
- image-group geometry and crop helpers,
- PDF layout primitives,
- workspace registry behavior, and
- settings normalization.

Prefer domain tests when the bug can be reproduced without React or Tauri.

### React components and feature providers

Component tests cover user-visible behavior for:

- the workspace launcher, project rail, and project cards,
- app-shell resizing and focus mode,
- settings interactions,
- save-state UI,
- the BlockNote editor wrapper,
- image-group block behavior, and
- the reference-image lightbox.

Use React Testing Library and assert via roles, labels, visible text, and interaction outcomes.

### Infrastructure adapters

Adapter tests validate:

- Tauri workspace/plan/settings/screen-capture/PDF adapters,
- browser test adapters used by memory and Midscene modes,
- argument shaping for narrow native commands, and
- logging/sanitization helpers.

These tests should confirm boundary contracts without re-testing the pure domain logic underneath them.

### Rust

Rust unit tests cover:

- project creation and inspection,
- manifest reading and migration from `.preshot` to `.preshotproj`,
- manifest plan save/load,
- reference-image import/load/remove,
- native media import/load/remove,
- settings read/write behavior,
- PDF atomic writes, and
- Windows screen-capture helpers.

### Playwright

`pnpm test:e2e` exercises the browser-shell path used for smoke coverage. It starts Vite in `e2e` mode, uses Microsoft Edge, and validates top-level workflows such as workspace loading, project opening, editor presence, and related UI flows.

`pnpm test:e2e:blocknote` is the focused browser suite for the current v14 editor surface. Use it when changing BlockNote document behavior, image groups, columns, native media, or PDF-adjacent editing flows.

### Midscene

Midscene tests are intentionally slower and serialized (`maxWorkers: 1`, no file parallelism). Use them when you need AI-assisted browser evidence beyond deterministic Playwright assertions.

## Documentation-linked behavior

The editor interaction contract lives alongside the design docs:

- [BlockNote v14 design](design_docs/blocknote_v14_design.md)
- [UI/UX contract](design_docs/UI_UX_CONTRACT.md)

When accepted behavior changes, update the implementation, the relevant tests, and those references together.

## Recommended test selection

- Small pure-logic change: run the smallest affected Vitest file first.
- Adapter-only change: run the matching adapter tests plus the nearest smoke coverage.
- Editor UI change: run the focused component tests first, then `pnpm test:e2e:blocknote` if behavior crosses browser/editor boundaries.
- Native command change: run the Rust unit tests that cover that command, then the affected TypeScript adapter tests.
- Documentation-only change: application test runs are optional unless you changed behavior claims; validate the edited document links instead.

## Non-goals

- Do not use broad snapshot coverage for dynamic editor, image layout, or PDF output.
- Do not replace deterministic browser assertions with Midscene-only evidence.
- Do not “fix” failing tests by loosening accepted behavior without updating the documented contract.
