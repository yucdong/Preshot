# Independent project copy acceptance

[Documentation index](../README.md) · [Feature guide](../features/projects.md)

Date: 2026-09-30. Target: Preshot 0.0.18, Windows x64.

## Scope and user stories

| Story | Evidence | Result |
| --- | --- | --- |
| Copy an active project with recent text and card-field edits | Real editor/provider preparation and browser journey | Passed |
| Wait for an attachment upload to publish before saving | Real editor and deferred native-media boundary | Passed |
| Preserve source undo history and retain both open sessions | Provider undo regression and independent browser edits | Passed |
| Copy background and closed projects | Browser journey with three successive copies | Passed |
| Suggest a sibling name, show final path, use keyboard and both UI languages | Browser journeys and inspected screenshots | Passed |
| Cancel and retry without duplicate publication | Native streaming cancellation, dialog duplicate guard and browser journey | Passed |
| Stop on source save failure and retain form input | Browser failure/retry journey | Passed |
| Preserve all sample components, columns, media, cover and layout | Native comparison of full copied document and referenced bytes | Passed |
| Keep source deletion from breaking the copy | Native temporary-project test removes source, reads copy and retries receipt | Passed |
| Keep network image URLs and old supported document versions unchanged | Native versions 13 through 17, legacy manifest marker | Passed |
| Reject missing files, invalid names, nested destination, changed identity/source and locked input | Native temporary-project matrix | Passed |
| Refuse a destination created during copying; preserve foreign files | Native late-collision regression | Passed |
| Recover interruption and publication with durable operation IDs | Native staging/published receipt tests; adapter lost-response tests | Passed |
| Retain completed copy after registry failure and retry only registration | Workspace domain failure/retry test | Passed |
| Copy originals above 256 MiB and a group above 512 MiB | Explicit real-image native test | Passed |
| Export the native copied sample through PDF, DOCX and long-image pipelines | Dedicated browser exporter integration and rendered PDF/image inspection | Passed |
| Operate the installed MSI through an isolated desktop session | Desktop automation health check | Blocked by Windows screenshot failure |

## Large originals and ownership

The fixture uses two independent files containing the same valid 10000 by 10000
PNG. Each file is **300221278 bytes**, exceeding 256 MiB; together they exceed
512 MiB. Both copied originals match SHA-256
`1d7a0cdfddddda032c5253bf739bd3a35a11d09be10d9ab264f42df06ac5cd82`.
Overwriting one copied file leaves the other copy and the source unchanged.
The stream uses a 64 KiB buffer and does not decode or send originals through IPC.
The test finished in 110.75 seconds in the debug native test runner, including
fixture copying and repeated source/destination hashing; this is not a release
performance benchmark. Peak working-set behavior was not separately benchmarked.

The complete bundled Nanjing sample is copied using the production native copier.
Its document differs only in the requested plan title, with a fresh project ID,
name and timestamps. Export artifacts and an unused reference are excluded.
The copied fixture used for exporter integration is explicitly emitted into
`.preshot-build-cache/project-copy-export-fixture`.

## Defects found and fixed

- Opening the modal hid the active workspace. Visibility and interaction state
  are now separate, retaining the document behind the modal.
- Escape initially failed to return focus to the source menu trigger because
  the shell was inert. Capture the trigger before opening and restore focus
  after the shell commit.
- The upstream File block has no `showPreview` property. Shared document
  validation now accepts its actual schema, preventing attachment-save failures.
- Rendered-PDF inspection found a short three-card row drawing its images below
  the page boundary. The PDF mapper now keeps a row of short cards together;
  oversized cards and general tall columns remain paginated. Regression tests
  count every image draw and check its actual page bounds, rather than accepting
  a successfully generated file as proof of visibility.
- Retrying an uncertain in-flight copy must not re-save the source while native
  copying still holds it. Resume now queries/continues the original operation.

## Reproduction and evidence

All browser outputs use explicit isolated output directories; the original bug
list and its screenshots are preserved. Browser workspace tests inject only the
native-copy/storage boundary and use the real domain service, workspace and editor.
Physical file independence and streaming are tested in Rust, not inferred from
the browser fixture's in-memory files.

```powershell
pnpm exec vitest run src/domain/workspace src/infrastructure/workspace src/features/workspace/CopyProjectDialog.test.tsx src/features/plan/blocknote/projectCopyPreparation.test.ts
cargo test --manifest-path src-tauri/Cargo.toml workspace::copy::tests
$env:PRESHOT_COPY_LARGE_FIXTURES = 'C:\projects\Preshot\.preshot-build-cache\buglist1-fixtures'
cargo test --manifest-path src-tauri/Cargo.toml real_large_originals_copy_independently_without_byte_caps -- --ignored
pnpm exec playwright test e2e/project-copy.spec.ts --output .preshot-build-cache/project-copy-ui-rerun
```

For the export test, set `PRESHOT_COPY_ACCEPTANCE_OUTPUT` to a **new** directory
under `.preshot-build-cache`, run native test
`independent_copy_keeps_complete_document_and_only_referenced_originals`, then
run `e2e/project-copy-exports.spec.ts` with that same variable and an isolated
Playwright `--output` directory. The native fixture deliberately refuses to
overwrite an existing output directory.

Logs remain under `.preshot-build-cache/project-copy-*.log`. Screenshots show
the source document behind the dialog, independent sessions, and the English
dialog with keyboard focus. Original source files were never modified by the
copier; all destructive test operations use temporary roots.

- [Chinese copy dialog](media/project-copy/copy-dialog.png)
- [English dialog and keyboard focus](media/project-copy/copy-english.png)
- [Independent open projects](media/project-copy/independent-copy.png)
- [Rendered copied PDF, all three pages](media/project-copy/copied-pdf-pages.png)
- [Copied long-image excerpt](media/project-copy/copied-long-image.png)

## Final validation and limitations

Validation includes **243 passing tests across 22 Vitest files**, eight standard native tests plus the separately enabled
real-large-original test; four browser workspace journeys and one three-format
export journey; TypeScript, focused ESLint, documentation, localization and
production-script checks. The rendered PDF has three pages and eight image
placements, all inside page bounds. Long-image output is 900 by 3372 pixels.
DOCX includes the sample text and embedded illustrations. Word application
rendering was not independently inspected in this run.

The final **0.0.18 x64 MSI** was built, checked against the packaging contract and
installed by upgrading the previous acceptance installation. Windows Installer
returned **0**. Only the known isolated acceptance process was closed; developer
projects and the real profile/library were not used. The installed executable
matches the build exactly after accounting for Tauri's documented three-byte
MSI bundle marker. Its native image worker processed the 300221278-byte original
in **3.38 seconds**, exit code **0**, with unchanged source hash.

Artifact: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Preshot_0.0.18_x64_en-US.msi`
(26542080 bytes). SHA-256:
`e04b3f1632480f4346a94161f98a4b8f60b329dd0ef15aef58d1520b7746bbad`.
Installation and payload evidence:
`.preshot-build-cache/project-copy-installed/final-package-result.json` and
`.preshot-build-cache/project-copy-upgrade-0.0.18.log`.

The desktop health check failed with
`CopyFromScreen: The handle is invalid`. The computer-automation workflow
requires screenshot and mouse health checks before further UI operations, so
installed interactive/visual acceptance remains pending an accessible unlocked
Windows desktop. No destructive uninstall matrix was attempted. Tests cover
interrupted receipts and write/locked-file failures; this run does not fill the
physical disk or claim complete Windows permission/display-scale coverage.
