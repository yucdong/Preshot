# Testing

## Strategy

Preshot is building toward this test pyramid:

1. Pure domain unit tests should form the majority as capabilities are added.
2. React component tests cover accessible, user-visible behavior.
3. A small Playwright layer verifies that the browser application starts.
4. Rust unit tests cover native logic without launching a desktop window.
5. TypeScript and ESLint provide static checks.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run all Vitest tests once. |
| `pnpm test:init` | Test initializer failures and toolchain version boundaries. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:e2e` | Run Playwright smoke tests in Microsoft Edge (Chromium). |
| `pnpm typecheck` | Check frontend and tooling TypeScript projects. |
| `pnpm lint` | Run ESLint. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Run Rust tests. |
| `pnpm build` | Type-check and build the frontend. |

Playwright uses the Microsoft Edge installation provided with supported
Windows versions, so project initialization does not download another browser.

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

Playwright starts the Vite server defined in `playwright.config.ts` with
`pnpm dev --mode e2e`, which loads `.env.e2e` and sets
`VITE_WORKSPACE_ADAPTER=memory`. That selects the in-memory workspace adapter
(`src/infrastructure/workspace/browserWorkspace.ts`), so the browser suite runs
without Tauri against a single seeded "Editorial Demo" project. The adapter fails
closed in production builds. Keep this suite limited to high-value startup and
cross-feature flows; component-level variations belong in Vitest.

## Rust Tests

Keep pure helper functions separate from `#[tauri::command]` wrappers and test
the helper directly. Run Cargo from a Visual Studio Developer PowerShell when
another application has placed a conflicting `link.exe` earlier in PATH.

## Workspace Setup Coverage

- **Domain**: `registry.test.ts`, `service.test.ts`, and `models.test.ts` cover
  pure rules -- sorting, upsert, availability, relocation authorization, and the
  serialized create/open/relocate/remove flows with rollback -- using typed fakes
  only.
- **Adapters**: `workspaceStore.test.ts`, `workspaceDialog.test.ts`,
  `tauriWorkspace.test.ts`, and `tauriDesktop.test.ts` mock only the Tauri
  boundary (`invoke`, Store `load`, dialog `open`) and assert command names,
  serialized inputs, validated responses, and contextual failures.
- **Rust**: `src-tauri/src/workspace.rs` tests exercise real manifest creation,
  inspection, cover resolution, and rollback inside `tempfile::tempdir`
  fixtures; `menu.rs` tests cover menu-ID routing and window labels.
- **Components**: `WorkspaceLauncher`, `WorkspaceProvider`, `dependencies`, and
  `App` tests query by accessible role and name, and cover the busy-action guard,
  the native menu flow, and the fail-closed adapter selection.
- **Browser**: `e2e/workspace.spec.ts` opens the seeded project from the
  launcher.

## Plan Coverage

- **Domain**: `reducer.test.ts` and `service.test.ts` cover pure plan rules --
  adding/renaming/deleting groups, editing group descriptions, setting columns
  (clamped 1..=6), setting `photographyPlan` HTML, importing/removing images,
  and the guarded mutation flows -- using typed fakes only. `service.test.ts`
  also asserts that pure-metadata use cases do not persist, that
  `setPhotographyPlan` stays in-memory until saved, and that `savePlan` is the
  explicit persistence path.
- **Adapters**: `tauriPlan.test.ts` and `browserPlan.test.ts` mock the Tauri
  boundary (`invoke`) and assert command names (`save_project_plan`,
  `read_project_plan`, `import_reference_image`, `load_reference_image`,
  `remove_reference_image`), serialized inputs, validated responses, and
  contextual failures. The browser adapter seeds "Editorial Demo" for E2E.
- **Rust**: `src-tauri/src/plan.rs` tests exercise atomic manifest writes,
  validated imports with move semantics and renumbering, base64 data URL
  encoding, and file removal inside `tempfile::tempdir` fixtures.
- **Components**: `ReferenceImagesTab`, `ProjectPlanProvider`, and `PlanPanel`
  tests query by accessible role and name, and cover the guarded action flows,
  the rich-text plan body and per-group description editors (high-contrast text,
  in-memory edits, auto-saved HTML), the single tab-free panel, image rendering,
  lightbox open/close, and error states. `ProjectPlanProvider` also uses fake
  timers to assert the 5-second auto-save flushes a changed plan once and writes
  nothing when unchanged.
  `RichTextEditor.test.tsx` covers the shared TipTap toolbar, placeholder
  rendering, and emitted HTML for the supported schema-safe subset; these tests
  use a deterministic jsdom editing approach so selection and formatting
  assertions stay stable without a real browser.
- **Browser**: `e2e/plan.spec.ts` opens the seeded project, verifies reference
  images render, and tests the lightbox flow.

## Before a Change Is Complete

Run:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:init
pnpm test:e2e
cargo test --manifest-path src-tauri\Cargo.toml
pnpm build
```

Add a failing regression test before fixing a defect. Do not silence failures
or weaken assertions to make a suite pass.
