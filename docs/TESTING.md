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
  explicit persistence path. `domain/plan/pdf/geometry.test.ts`,
  `document.test.ts`, and `export.test.ts` cover the pure A4 geometry helpers,
  square contain-fit calculations, `buildExportDocument` section ordering, and
  contextual export wrapping.
- **Adapters**: `tauriPlan.test.ts` and `browserPlan.test.ts` mock the Tauri
  boundary (`invoke`) and assert command names (`save_project_plan`,
  `read_project_plan`, `import_reference_image`, `load_reference_image`,
  `remove_reference_image`), serialized inputs, validated responses, and
  contextual failures. `infrastructure/pdf/htmlToBlocks.test.ts` covers HTML
  parsing for headings, emphasis, lists, fallback paragraphs, links, the
  underline/strikethrough/color marks, and the BlockNote block-type cases
  (checklists as bullets, code blocks as preformatted paragraphs, and tables
  flattened to one paragraph per row);
  `pdfLibExporter.test.ts` generates a real A4 PDF with CJK text, styled runs,
  and a framed letterboxed image slot using bundled Noto Sans SC;
  `tauriPdfSave.test.ts` covers
  dialog cancellation and the `save_pdf` command payload. The browser adapter
  seeds "Editorial Demo" for E2E.
- **Rust**: `src-tauri/src/plan.rs` tests exercise atomic manifest writes,
  validated imports with move semantics and renumbering, base64 data URL
  encoding, and file removal inside `tempfile::tempdir` fixtures.
  `src-tauri/src/pdf.rs` separately verifies that `save_pdf` decodes base64 and
  writes the requested PDF bytes.
- **Components**: `ReferenceImagesTab`, `ProjectPlanProvider`, and `PlanPanel`
  tests query by accessible role and name, and cover the guarded action flows,
  the rich-text plan body and per-group description editors (high-contrast text,
  in-memory edits, auto-saved HTML), the single tab-free panel, image rendering,
  lightbox open/close, and error states. `ProjectPlanProvider` also uses fake
  timers to assert the 5-second auto-save flushes a changed plan once and writes
  nothing when unchanged, and it covers the export handoff from `Export PDF`
  through `PdfExporter` to `PdfSaveTarget`, asserting the save target receives
  the `<project>\output.pdf` default path. `PlanPanel.test.tsx` keeps the
  button wiring explicit. `AppShell.test.tsx` asserts the three-column shell
  (project switcher, plan workspace, and Assistant panel) with children, and
  `AgentPanel.test.tsx` verifies the disabled Assistant preview input and Send
  button.
  `RichTextEditor.test.tsx` is now a thin jsdom smoke test (labelled region,
  HTML hydration) because BlockNote needs real browser APIs; the higher-level
  suites (`PlanPanel`, `ReferenceImagesTab`, `ProjectPlanProvider`, and
  `WorkspaceProvider`) mock `RichTextEditor` as a labelled textarea, and
  `App.test.tsx` keeps the real editor. Real editing is covered by a Playwright
  e2e in `e2e/plan.spec.ts`.
- **Browser**: `e2e/plan.spec.ts` opens the seeded project, verifies reference
  images render, tests the lightbox flow, and clicks `Export PDF` to exercise
  the real browser `pdfLibExporter` plus the browser save target. The export
  smoke test waits for the busy label to return to `Export PDF` and asserts no
  error banner appears.

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
