# Installed Nanjing demo acceptance

[Documentation index](../README.md) · [Sample](../../samples/README.md) · [Recording](../demo/README.md)

This report preserves the historical full walkthrough and 0.0.10/0.0.11 test
evidence. The README media has since been replaced by the
[short 0.0.12 recording](short-demo-acceptance.md); the current linked MP4, GIF
and PDF belong to that new blank-project flow. Historical screenshots and
artifact hashes below still describe the earlier run.

Verified on September 29, 2026 with locally built **0.0.10 / 0.0.11 x64 MSIs** and
`%LOCALAPPDATA%\Programs\Preshot\preshot.exe`. The sample, video, GIF and actual
exported PDF are ready. Native divider resizing remains a manual acceptance gap;
the equivalent browser integration test passed.

## Scope and stories

The photographer starts with an offline bridge portrait plan, creates another
shoot, adds pictures, builds reusable materials, arranges columns, reopens saved
work and exports a shareable document.

The sample covers all 22 supported block types: paragraph, heading, bulleted,
numbered, checklist and toggle items, quote, code, table, divider, page break,
image group, image, video, audio, file, location, model, prop, clothing,
column list and column. It has two-/three-column rows, five cards and seven
independent reference images. Model A and prop pictures are mock illustrations.
The attached video pans a credited photo; the audio is synthesized.

| ID | Priority | Story / expected result | Evidence / result |
| --- | --- | --- | --- |
| ND-01 | P0 | First installed launch seeds a complete offline sample | Passed in installed app; files and manifest inspected |
| ND-02 | P0 | Existing projects and modified files survive bootstrap recovery | 40 native workspace tests and 2 rollback tests passed using temporary roots |
| ND-03 | P1 | Every supported component has valid data and local assets | Schema/asset test passed; installed sample toured; video/audio played to their ends |
| ND-04 | P0 | Create a project, write content, upload and reopen | Passed through installed UI; restart retained title, image, columns and inserted materials |
| ND-05 | P0 | Create pictured materials, save, search, preview and reuse | Six materials across five kinds created in installed UI; first Save closed each creation editor; seven independent image instances and ready previews verified |
| ND-06 | P1 | Drag a block beside another to create columns | Passed in installed UI and persisted manifest; seeded two-/three-column cards display their pictures |
| ND-07 | P1 | Resize columns, undo/redo, save/reopen and retain gallery geometry | Browser integration passed; native posted-pointer gestures did not persist changed weights, so no native resize pass is claimed |
| ND-08 | P1 | Insert a single-image material as Image and reuse a group | Passed in installed UI/manifest; group selection dialog shown and full group inserted |
| ND-09 | P0 | Export PDF and inspect the opened result | Actual 3-page export opened in Edge; all reader pages visually inspected and recorded |
| ND-10 | P0 | Export DOCX and one long image | DOCX has 4 tables, 8 media files and expected titles; JPEG is 900 × 3372 and visually inspected |
| ND-11 | P0 | Restart and retain library previews and project images | Passed with the same isolated profile; Model A preview and sample cards rechecked |
| ND-12 | P1 | Provide a readable installed walkthrough in both READMEs | 177-second captioned MP4 and looping GIF generated; representative frames and PDF pages inspected |

## Execution and isolation

Both MSI installations succeeded (exit 0); the final installed version is 0.0.11.
The app process used profile, AppData and WebView2 overrides beneath
`.preshot-build-cache/installed-demo-final`. Real projects, the real library and
the system clipboard were not fixtures. The generator creates the committed
template; the new-project/library chapters separately operate the installed UI.
Application startup, rather than MSI, creates the user-owned sample with a fresh
project identity. Existing profiles retain their projects.

Midscene desktop capture encountered an invalid handle. Recording therefore uses
Windows UI Automation, posted pointer/key messages, native file dialogs and
`PrintWindow`. Tauri persistence/export runs through the actual UI; there are no
injected browser adapters, direct application IPC or app CDP/debugging ports.
The actual Edge PDF reader is also operated with Windows UI Automation. Browser
chrome is cropped from the published footage. Native capture is approximately
3–5 fps, encoded as a 24 fps MP4; setup is accelerated and PDF review stays at
normal speed.

Raw takes/logs remain under `.preshot-build-cache/installed-demo` and
`.preshot-build-cache/installed-demo-final`. Failed automation takes are retained
locally and excluded from publication. The unsuccessful native divider-resize
chapter is explicitly omitted by the renderer.

## Defects fixed

1. **Offline file attachments failed to load.** Native media handling rejected
   TXT. Added bounded TXT/PDF support (16 MiB), preserving rejection of unknown
   types and oversized files. The import/reopen regression failed before the fix
   and passed afterward; the installed sample attachment now loads.
2. **Unspaced Chinese text overflowed PDF lines.** A real React-PDF layout
   regression measured 644 pt inside a 547 pt line. Added grapheme-aware CJK
   breaks preserving text, punctuation pairs and Latin hyphenation. The
   regression/PDF suite passed and all installed PDF pages fit on visual review.

## Validation

| Check | Result |
| --- | --- |
| Full production validation before final PDF fix | 1,551 frontend tests / 181 files; Rust 318 passed / 5 ignored; lint, typecheck, initializer, production-script harness and docs passed |
| PDF suite after fix | 115 passed |
| Final focused sample/PDF regressions | 19 passed |
| Native ownership follow-up | 40 workspace tests and 2 rollback tests passed |
| `pnpm test:e2e:blocknote e2e/multi-column.spec.ts --grep 'creates and removes'` | 1 passed: column creation/removal, widths, undo/redo, gallery geometry and save/reopen |
| Final MSI build/install | Build succeeded; normal upgrade exit 0; installed version 0.0.11 |
| Release artifact contract | Passed; metadata marks the local package unsigned and not publishable |

The full production run used interim 0.0.9. The recording used installed 0.0.10
after the PDF fix. Final 0.0.11 includes equivalent regex escape cleanup for lint;
its frontend/typecheck build, focused 19 regressions and lint passed. A normal
MSI upgrade then rechecked sample images, the retained library preview and a fresh
three-page PDF export. The video continues to show the actual 0.0.10 recording.
All three PDF pages from 0.0.11 render pixel-identically to that recorded export.

## Review evidence

- [Reopened library preview](media/installed-demo/reopened-library.png)
- [Reopened sample cards](media/installed-demo/reopened-sample.png)
- [Reader page 1](media/installed-demo/pdf-page-1.png), [page 2](media/installed-demo/pdf-page-2.png), [page 3](media/installed-demo/pdf-page-3.png)
- [Long-image overview](media/installed-demo/long-image.png)
- [Artifact sizes and SHA-256](media/installed-demo/artifacts.json)
- [Actual PDF](../media/preshot-demo.pdf), [MP4](../media/preshot-demo.mp4), [GIF](../media/preshot-demo.gif)

MSI: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Preshot_0.0.11_x64_en-US.msi`.
SHA-256: `47EE28472D341CF75D3AB9BAF68F057E783E954687F8A5503D36BAF7ED112D89`.
The installed EXE differs from the build EXE at Tauri's three-byte bundle marker
(`MSI` versus `UNK`); its hash is recorded separately.

## Limits

- Native physical-pointer divider resizing needs an interactive desktop pass;
  browser integration does not substitute for that evidence.
- Screenshot entry points are shown, but successful Windows snipping, live
  clipboard paste and capture cancellation/retry were not exercised here.
- Full-group insertion was exercised; partial selection and individual-image
  variants were not exhaustively rerun.
- DOCX structure/assets were checked; Word layout was not visually inspected.
- Developer-machine install/upgrade passed. No destructive clean-VM
  install/repair/uninstall matrix ran.
- The MSI is unsigned and for local testing. No GitHub release was published.
  Release metadata names the base commit; commit these workspace changes and
  rebuild/sign before publication.
