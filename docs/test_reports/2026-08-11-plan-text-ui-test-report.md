# Text Component UI Test Report

**Date:** 2026-08-11
**Scope:** Text component, canvas interaction, workspace, theme, layout, undo/redo, PDF
**Conclusion:** Existing deterministic tests found no stable product failures; the Midscene new-project journey was not run because the environment was not configured.

## Execution Results

| Check | Result |
|---|---:|
| Text/Canvas Playwright | 42 / 42 passed |
| Full Playwright E2E | 54 / 54 passed |
| Full Vitest (serial rerun) | 84 files / 464 tests passed |
| Isolated timeout-test rerun | 5 / 5 passed |
| TypeScript | Passed |
| ESLint | 0 errors / 1 warning |
| Production build | Passed, with chunk-size warning |
| Midscene AI suite | Not run: model variables and dependencies missing |

Captured screenshot: `test-results/2026-08-11-plan-text-ui-current-state.png` (this directory is not committed per repository rules).

## Verified Text Capabilities

- insert, delete, reorder, and resize;
- text editing and autosave;
- paragraph, H1-H6, and valid font-size display;
- bold, italic, underline, strikethrough, and alignment;
- unordered/ordered list markers;
- theme colors, RGB, circular color picker, brightness, and instant apply;
- links, popover open/close, and selection preservation;
- recursive left/right and top/bottom splits, leaf deletion, and undo;
- narrow-toolbar scrolling, hover hints, and close-button containment;
- clearing selection by clicking card whitespace or resize chrome;
- reload persistence, Ctrl+Z/Ctrl+Shift+Z;
- PDF export completion;
- workspace, theme, and responsive layout interaction.

## Issue List

### P1 — Midscene test environment not ready (blocking)

The following variables were not configured:

- `MIDSCENE_MODEL_BASE_URL`
- `MIDSCENE_MODEL_API_KEY`
- `MIDSCENE_MODEL_NAME`
- `MIDSCENE_MODEL_FAMILY`

`@midscene/core` and `@midscene/web` were also not installed. As a result, the AI user journeys, merged HTML report, and live recording of “clean up after creating a project through the UI” could not be executed.

Suggested action: configure the model variables in the local `.env`, then run `test:midscene:web`. Keys should not be shared over chat.

### P2 — Unit tests may false-time out under heavy parallel load (medium)

When full-repo Vitest, typecheck, and lint were first run in parallel:

- `src/app/plan/planDependencies.test.ts`
- `uses the in-memory service outside production`
- timed out at the explicit 15-second limit.

Afterward:

- isolated rerun passed 5 / 5 in about 4.24s;
- with no other parallel load, the full repo passed 464 / 464 in about 45.23s.

Assessment: this is not a stable product failure, but a reliability risk under high CPU/IO contention.

Suggested action: do not run full Vitest with lint/typecheck at high concurrency on the same CI machine; alternatively, give the heavier dynamic-import dependency tests a reasonable suite-level timeout and track runtime trends.

### P3 — Production bundle size warning (medium, performance risk)

The production build succeeded, but Vite reported the main JS chunk over 500 kB:

- `index-*.js`: about 2,399.69 kB, gzip about 899.23 kB;
- Noto Sans SC Regular/Bold are each about 10.6 MB.

This is not part of the current text-feature regression, but it affects first load and installer size.

Suggested action: split low-frequency modules such as PDF/editor, check whether fonts should be loaded in the main web bundle, and define a bundle budget.

### P4 — ESLint Fast Refresh warning (low)

`src/app/theme/ThemeProvider.tsx:29`:

- `react-refresh/only-export-components`

Current state is 0 errors / 1 warning and it does not block the build.

Suggested action: move non-component constants or helpers into a separate module.

## No Stable Product Issues Found

Within the current seeded browser project and the existing automation coverage, no consistently reproducible text-component failures were found. All 42 text-related E2E scenarios and all 54 UI scenarios in the repo passed.

## Coverage Gaps

The following goals were not completed in this round:

- create a brand-new real project through the UI;
- run 8 new-project journeys with Midscene `aiAct`;
- generate the merged Midscene HTML report;
- remove the project through the UI after testing and verify zero test-adapter residue.

The reason was not a product UI failure; the current browser adapter does not support creating a new project, and the Midscene model/dependencies were not configured. See `docs/superpowers/plans/2026-08-11-midscene-plan-text-ui-automation.md` for the execution plan.
