# Project groups and name search acceptance

[Documentation index](../README.md) · [Feature guide](../features/projects.md)

Date: 2026-10-01. Environment: Windows x64, Microsoft Edge browser shell.

## Verified behavior

| Scenario | Evidence |
| --- | --- |
| Localized built-in default, unchanged custom names, visible create/delete buttons | Component coverage and Chinese/light, English/dark browser screenshots |
| Create, rename, reserved/duplicate name rejection, protected default | Domain and keyboard-driven component tests |
| Single-confirmation deletion returns projects to default without deleting project files | Domain/service transaction tests, failed-save retry and real-app browser flow |
| Drag into collapsed/empty groups; search exposes otherwise hidden targets | Dedicated browser drag journey |
| Preview, outside release and Escape never persist | Browser comparisons of registry organization before and after gestures |
| Move through the project menu; expand destination | Component and browser journeys |
| Literal Chinese/English name search, unavailable projects, normalized highlighting | Domain and component coverage |
| Search temporarily expands groups; clearing restores collapse; query survives switching | Browser journey using multiple mounted real editors |
| Chinese composition does not prematurely filter or submit; keyboard focus stays in dialogs | Component composition and focus tests |
| Grouping preserves editor identity, content, undo/redo and open sessions | Browser DOM identity, actual typing and undo/redo assertions |
| Narrow rail, wrapping create button, direct delete icon, focus panel | Browser journey at the 176px minimum rail width and inspected screenshots |
| Restart restores membership/collapse while clearing the search | Browser reload with persisted registry |
| New, first-opened and copied projects use default; reopen/relocation retains membership | Workspace service tests |
| v1 migration retains its backup through later saves; v2 downgrade and corruption fail safely | Native temporary-root tests |
| Failed native backup preserves the complete prior organization and allows retry | Native filesystem failure injection |
| Switching to another user root loads its own groups without merging registries | Native profile-switch test with a populated v2 registry |

## Validation commands

```powershell
pnpm test
pnpm lint
pnpm build
pnpm i18n:check
pnpm docs:check
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked storage::
pnpm exec playwright test e2e/project-groups.spec.ts e2e/workspace.spec.ts e2e/project-copy.spec.ts e2e/project-delete.spec.ts --workers=1
```

The final full Vitest run passed all **1691 tests in 197 files**. The browser
regression matrix passed all 15 cases. After the final sidebar layout
adjustment, the three group-specific journeys passed again, including real editor
undo/redo. The native storage suite passed all 27 tests. Production build includes
TypeScript checking. ESLint reports only the two existing fast-refresh warnings
in `preshotImageBlockSpec.tsx`; Vite retains its existing large-chunk warning.

The initial full Vitest run exposed an existing image test that asserted its
resolved URL immediately on editor readiness. Media resolves asynchronously; the
test now waits for the actual images before checking independent persisted paths.
The focused rerun and the final full suite passed. Unicode highlighting also
merges overlapping matches within one grapheme so composite emoji names never
render duplicated text.

## Evidence and limits

Browser artifacts are under `.preshot-build-cache/playwright/project-groups-final`;
the wider regression artifacts are under `.preshot-build-cache/playwright/default`.
Build/native/unit-test logs use `.preshot-build-cache/project-groups-*`.

Browser tests use isolated injected project/storage adapters with the real app,
workspace service and BlockNote editor. Native tests use temporary directories;
they do not read or change the developer's actual user registry. Chinese IME
composition events are simulated; no live operating-system IME session was used.
Midscene was unavailable because its configured model endpoint and browser launch
were unavailable; Playwright and screenshot inspection provided browser coverage.
No installed MSI or clean-VM installer matrix is claimed for this feature.
