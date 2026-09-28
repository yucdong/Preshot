# MSI 0.0.3 material-library regression

Tested on 2026-09-28. All three reported symptoms were reproduced in the
installed Windows application. This report records diagnosis of the original
0.0.3 package; no application fix or replacement installer was produced in
this test run.

## Installation and isolation

- Installed `Preshot_0.0.3_x64_en-US.msi` with Windows Installer; exit code `0`.
- MSI SHA-256: `f632f43b2c21f636edd279cde4fd56c7fab9e2f2bc66ec05fc97e024eb2cb99d`.
- Package source: tag `v0.0.3`, commit `58f780e`.
- Executed `%LOCALAPPDATA%\Programs\Preshot\preshot.exe`, version 0.0.3,
  with WebView2 154.0.4258.37.
- The installed EXE SHA-256 is
  `91e4dccceaf323326fd0badd9098cde88864738862acf1af3cff5584cc7b57c3`.
  It differs from the adjacent build EXE only in Tauri's three-byte bundle
  marker, `UNK` to `MSI`.
- Closed the existing development window after observing its saved status.
  Test processes used a separate `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
  and WebView2 data folder under
  `.preshot-build-cache/msi-library-regression`.
- Operated the actual native window and Windows file dialogs using mouse
  input and Unicode keyboard input. No application repository, native command,
  image loader, or persistence adapter was mocked. The clipboard was not used.

The temporary profile must contain `Desktop`, `Documents`, `Pictures`,
`AppData/Local`, and `AppData/Roaming` before startup. An incomplete initial
profile caused a Windows known-folder error; creating those directories and
restarting resolved it. That setup error is separate from the product defects.

## Results

| Scenario | Actual result | Assessment |
| --- | --- | --- |
| Create an image material and import `model-a.png` | Image displays in the isolated editor before and after Save | Image import and content save pass |
| Save that new material | Dialog changes from Create to Edit and remains open | Reproduces the reported behavior; does not meet the requested automatic-close expectation |
| Close editor and inspect the library | Thumbnail contains an empty gray image frame | Fail |
| Open full preview of the created material | Broken-image icon and gray frame | Fail |
| Upload `transparent-umbrella.png` to a project, select it, and save to library | Save completes and the project save dialog closes | Content save passes |
| Inspect that saved material's thumbnail and full preview | Both omit the image | Fail |
| Insert the created image material into the project | Model image displays as a native image block | Pass |
| Restart installed Preshot and reopen library | Both records persist; gray thumbnails remain | Persistence passes; preview defect persists |
| Verify original copies and SQLite integrity | Both copies match source SHA-256; `PRAGMA integrity_check` returns `ok` | Pass for these test assets |

Evidence from the installed application:

- [Created material after Save, with image and editor still open](media/msi-0.0.3/created-stays-open.png)
- [Full preview of the created material](media/msi-0.0.3/created-broken-preview.png)
- [Full preview of the material saved from a project](media/msi-0.0.3/project-broken-preview.png)
- [Library material successfully inserted into the project](media/msi-0.0.3/inserted-image.png)
- [Persisted gray thumbnails after restart](media/msi-0.0.3/restarted-library.png)

## Image-rendering diagnosis

[Material preview preparation](../../src/infrastructure/library/materialPreviewAssets.ts)
loads and validates the original bytes, decodes them, then exposes
`URL.createObjectURL(blob)` to the preview surface. The
[production CSP](../../src-tauri/tauri.conf.json) permits only
`img-src 'self' data:`. Chromium blocks the resulting `blob:` image URL.

A separate local Edge experiment applied the exact configured production CSP
to the same PNG bytes. This is a policy-level diagnostic in addition to the
native application reproduction, not a capture of its console:

| Image source | Current production CSP | Candidate with `blob:` added only to `img-src` |
| --- | --- | --- |
| Data URL | Loads at 960 x 720 | Loads at 960 x 720 |
| Blob URL | Blocked; natural size 0 x 0; `securitypolicyviolation` for `img-src` | Loads at 960 x 720; no violation |

The gray-frame thumbnails are also saved as PNGs. They survive application
restart, so a future fix must regenerate affected cached previews, not only
allow the live preview to load. Review the `RENDER_KEY` in
[materialPreview.tsx](../../src/infrastructure/library/materialPreview.tsx),
cache invalidation, and rejection of captures with failed image elements.
Original image instances must remain unchanged.

## Creation-dialog diagnosis

[MaterialContentEditor](../../src/features/library/MaterialContentEditor.tsx)
calls `continueSaved(result)` after every confirmed save, including the first
save of a new material. It retires the old draft and opens a fresh edit lease.
The observed open window is therefore the existing continuation behavior,
not a failed database save or a stalled close operation.

To satisfy the reported expectation, new-material creation should close after
confirmed commit and owned-draft cleanup, then refresh the library. Existing
material editing can retain its continuous-save behavior. Unknown-save and
cleanup failures must retain recovery rather than pretending the operation
finished.

## Follow-up validation

A repair should first add failing regressions for blob images under the real
production CSP, invalid thumbnail capture/cache refresh, and first-save dialog
closure. Then test a newly versioned MSI with existing 0.0.3 library data as
well as a fresh profile. Cover image, image group, model, location, and combined
props/clothing categories, save failures/retries, and reopening after restart.

This run covered two PNG image materials and ordinary per-user installation.
It did not perform the clean-VM upgrade/repair/uninstall matrix or claim all
material categories and image formats were validated.

Local detailed evidence, diagnostic scripts, isolated database, and installer
log are retained in `.preshot-build-cache/msi-library-regression`.
