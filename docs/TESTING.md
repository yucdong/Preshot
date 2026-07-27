# Testing

## Strategy

Preshot uses a test pyramid:

1. Pure domain unit tests form the majority.
2. React component tests cover accessible, user-visible behavior.
3. A small Playwright layer verifies that the browser application starts.
4. Rust unit tests cover native logic without launching a desktop window.
5. TypeScript and ESLint provide static checks.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run all Vitest tests once. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:e2e` | Run Playwright Chromium smoke tests. |
| `pnpm typecheck` | Check frontend and tooling TypeScript projects. |
| `pnpm lint` | Run ESLint. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Run Rust tests. |
| `pnpm build` | Type-check and build the frontend. |

Install the Playwright browser once with:

```powershell
pnpm exec playwright install chromium
```

`init.ps1` performs this installation unless `-SkipBrowserInstall` is passed.

## Unit and Domain Tests

Co-locate `*.test.ts` files with the module under test. Prefer real pure
functions and concrete values. A domain test must not need jsdom, React, Tauri,
or native mocks.

Use the red-green-refactor cycle:

1. Add one test for one behavior.
2. Run the focused file and observe the expected failure.
3. Implement the minimum passing behavior.
4. Run the focused file again.
5. Refactor only while the test remains green.

## Component Tests

Use React Testing Library and query by accessible role, name, or visible text.
Assert what a user can observe rather than component state, CSS class lists, or
implementation details. Avoid snapshots for application layout and dynamic
canvas output.

## Platform Adapter Tests

Mock only the platform boundary. For Tauri adapters, mock `invoke` and verify
the command name, serialized inputs, returned value, and contextual failure.
Do not add test-only methods to production modules.

## Browser Smoke Tests

Playwright starts the Vite server defined in `playwright.config.ts`. Keep this
suite limited to high-value startup and cross-feature flows. Component-level
variations belong in Vitest.

## Rust Tests

Keep pure helper functions separate from `#[tauri::command]` wrappers and test
the helper directly. Run Cargo from a Visual Studio Developer PowerShell when
another application has placed a conflicting `link.exe` earlier in PATH.

## Before a Change Is Complete

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```

Add a failing regression test before fixing a defect. Do not silence failures
or weaken assertions to make a suite pass.
