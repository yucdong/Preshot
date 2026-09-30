# Material tutorials: recording and functional acceptance

[Documentation index](../README.md) · [Material library guide](../features/material-library.md)

## 1. Task understanding

Produce separate, captioned tutorials for each material category, creation
entry point, insertion workflow and management operation. Use the installed
Windows application, an isolated profile and the Nanjing bridge portrait theme.
Preserve the existing under-one-minute main walkthrough. Publish the tutorial
index, recordings, regression fixes and release sources to Git, then build the
latest x64 MSI. Thirty clips are recorded and verified; native screenshot
recording remains blocked by the remote desktop. The 0.0.21 MSI is built and
installed. This report accompanies the source and completed tutorials; the
remaining native screenshot recording is disclosed as incomplete.

## 2. Risk and priority

P0: original-image ownership, material save/cancel, independent project copies,
and deletion. Failures must not publish incomplete records or remove originals
owned by another material/project. P1: entry-point correctness, category routing,
previews, selection, search/favorites and layout. P2: pacing, captions and labels.

## 3. Core functional coverage

All five categories use name, description and tags. Cards retain their own
content fields. The launcher and project header provide library access; document
cards, image groups and selected individual images provide save entry points.
Image files, library reuse and screen capture populate image canvases. Native
image blocks provide another local-file upload path. External URL embeddings
are outside this offline material-copy workflow. Clipboard regression uses
an injected platform boundary, never the developer's live clipboard.

The local desktop application has one user role. Test normal directory access
and missing-file handling without changing real user data or system permissions.
Integrations are native dialogs/capture, project manifests, SQLite, independent
original files, native reveal, previews and exporters. Authentication/admin roles
are not application features. Installer lifecycle testing is not part of these
tutorials; verify the built artifact and normal installed startup.

## 4. Key scenario list

| ID | Priority | Tutorial / acceptance scenario | Status |
| --- | --- | --- | --- |
| C01 | P0 | Create an image material from the project library; metadata, file import, save and preview | Installed recording passed |
| C02 | P0 | Create an image group; import multiple pictures and retain ordering | Installed recording passed; progress covered by browser regression |
| C03 | P0 | Create a location card with location details and a sample image | Installed recording passed |
| C04 | P0 | Create fictional Model A with profile notes and a sample image | Installed recording passed |
| C05 | P0 | Create a props/wardrobe card with an umbrella picture and notes | Installed recording passed |
| C06 | P0 | Save a document location card to the library | Installed recording passed |
| C07 | P0 | Save a document model card to the library | Installed recording passed |
| C08 | P0 | Save a document prop card to the library; legacy clothing remains compatible | Installed recording passed |
| C09 | P0 | Save a complete document image group to the library | Installed recording passed |
| C10 | P0 | Save one selected gallery picture as an image material | Installed recording passed |
| C11 | P0 | Save a selected native image block as an image material | Installed recording passed |
| C12 | P1 | Upload a local picture through the native Image block | Installed recording passed |
| C13 | P0 | Capture into material/project images; cancel, retry and accept | Native recording blocked by desktop capture; injected-boundary regressions passed |
| C14 | P0 | Reuse existing library pictures inside a material draft | Installed recording passed |
| C15 | P0 | Create from launcher with no open project | Installed recording passed |
| C16 | P0 | Save through the per-picture tile shortcut | Installed recording passed |
| C17 | P0 | Duplicate-name confirmation, rename and discard new draft | Installed recording passed |
| C18 | P0 | Copy/paste into a new material and document | Browser fixture recording passed; in-memory clipboard only |
| I01 | P0 | Insert using the project header and customize the independent project copy | Installed recording passed; insertion undo/redo covered by browser regression |
| I02 | P1 | Insert through slash and left-side plus menus | Installed 0.0.21 recording passed; lower-viewport placement and final-item access also checked natively |
| I03 | P0 | Insert all/subset of group images as a group or separate image blocks | Installed 0.0.21 re-recording passed after native fix |
| I04 | P0 | Append library images into the current project group | Installed recording passed |
| M01 | P1 | Search by name, description and tag; category filters and sort | Installed recording passed |
| M02 | P1 | Favorite/unfavorite and favorite filter | Installed recording passed |
| M03 | P0 | Edit metadata/content; repeated save, cancel and discard behavior | Installed recording passed |
| M04 | P1 | On-demand full preview, picture selection and close | Installed recording passed |
| M05 | P1 | Reveal single/group originals from details, editor and preview | Installed recording passed |
| M06 | P0 | Delete confirmation/cancel, recycle-bin visibility and restore | Installed recording passed |
| M07 | P0 | Permanent deletion confirmation/cancel; inserted project copy remains intact | Installed recording passed |
| M08 | P1 | Image crop, resize, fit modes and undo/redo | Installed recording passed |
| M09 | P0 | Reorder pictures, remove, undo/redo and save | Installed recording passed |
| N01 | P0 | Empty/duplicate names, empty images, invalid import and abandoned drafts | Unit/native regression passed; installed duplicate/discard recording C17 passed |
| N02 | P0 | Metadata conflicts, missing originals and failed/uncertain save regression | Unit/native regression passed; faults were not injected into the installed recording |
| N03 | P0 | Clipboard import and cancellation through isolated platform test fixtures | Unit regression and C18 browser fixture passed; no Windows clipboard test |

## 5. Execution notes

Each successful take must retain raw screenshots, timestamps, UI errors and
post-action assertions in an ignored work directory. Failed takes are archived
and excluded from rendering. Verify original ownership and persisted metadata
read-only after UI actions. Add a failing regression before fixing a defect.
Rebuild/install fixes and re-record affected tutorials. Use explicit isolated
Playwright output directories; never clear `test-results` or existing bug lists.

Captioned tutorials should each stay below one minute. Inspect encoded frames,
duration and caption readability. Keep raw profiles, clipboard fixtures and
unrelated desktop chrome out of Git. Verify repository content before committing
and use a normal, non-forced Git push. MSI publication/signing remains separate
from committing source and tutorial assets.

## 6. Open questions

No product decisions are required to begin. The scope is material workflows;
the existing main walkthrough already covers project creation and PDF export.
Any platform-only verification gap will be identified explicitly in the final
results rather than presented as a passing test.

## Findings and fixes

### Native independent-image insertion

The installed 0.0.20 app rejected a gallery inserted as independent Image blocks
with `Inserted image does not match prepared order and content`. Whole galleries
and subset galleries passed. The native validator constructed default crop
values as floating JSON numbers, while JavaScript serializes integral defaults
as `0` and `1`. Rust JSON equality treated those encodings as different.

A native regression failed with the same error before the fix. The validator now
compares numeric properties by their exact numeric value, keeping the complete
property set, string/boolean values, order, fresh IDs, ownership and unchanged
surrounding plan checks. The regression covers a single-image material and a
split gallery, rejects altered crop/fit and extra fields, and checks original
bytes and the committed manifest. Native library regression: **166 passed,
4 helper tests ignored**. The fix is included in 0.0.21.

Evidence: [installed failure](media/material-tutorials/native-insert-before.png)
and [installed success](media/material-tutorials/native-insert-after.png).
The failed take is excluded from the media index. I03 was re-recorded against
installed 0.0.21 and passed all three modes. I02 also inserted a single-image
material through the slash menu successfully on that installed build.

### Metadata text selection

Material metadata inputs and textareas lacked the visible selection styling of
the card fields. The interaction regression failed before the CSS fix; applying
the same high-contrast selection colors passed the focused rerun. Existing
tests also needed to exclude range sliders from text-input checks, use
`Control+Home` for multiline text, and include the new Favorite detail action.
Those assertion updates are compatibility maintenance, not additional product
defects.

### Initializer test process wait

The production command reached 1629 passing unit tests, then its initializer
harness remained blocked in `Start-Process -Wait` even after the tested child
exited with the expected failure. The harness now waits on the specific process
handle, has a 60-second deadline, and launches hidden helper windows. All four
initializer checks passed afterward. Remaining production checks and packaging
are continued individually; the interrupted aggregate command is not reported
as a successful production build.

## Evidence and verification status

- [Tutorial index](../demo/material-tutorials.md), with one MP4 and poster per successful case.
- [Encoded-video inventory](media/material-tutorials/videos.json): full decode,
  SHA-256, dimensions and durations; each published clip is below one minute.
- [Read-only integrity audit](media/material-tutorials/integrity.json): SQLite
  integrity, distinct original instances, original hashes and project file references.
- Installed WebView2 menu checks at 150% Windows scaling and 75% document zoom:
  [upward placement](media/material-tutorials/native-menu-upward.png),
  [last item fully visible](media/material-tutorials/native-menu-final-item.png),
  and [geometry assertions](media/material-tutorials/native-menu.json).
  Browser cases additionally cover low window heights and device scale factors 1/1.5/2.
- Raw takes, logs and isolated profile: `.preshot-build-cache/material-tutorials-0.0.20`.
- `pnpm lint`: no errors, two existing Fast Refresh warnings.
- `pnpm typecheck`: passed.
- `pnpm test`: **191 files, 1629 tests passed**.
- `pnpm test:init`: four checks passed after the process-wait fix.
- `pnpm test:production-scripts`: passed.
- Full Rust checks on `x86_64-pc-windows-msvc`, all features/targets, locked:
  **386 passed, 8 tests ignored**, including optional large-file fixture tests.
- Browser material/menu/capture/import regression: **59 cases passed across
  the initial run and a focused rerun** (57 passed initially, two passed on rerun).
- MSI build, artifact contract and normal upgrade installation: passed for
  **0.0.21**, with isolated app startup verified. See
  [installer evidence](media/material-tutorials/installer.json).
- The MSI is a local unsigned artifact; signed-release publishing is not claimed.
- Source and completed tutorials include the native screenshot gap explicitly;
  publishing them does not imply that C13 has passed.

The first test in the final browser run hit the 60-second initial page-navigation
deadline while Vite was cold. Its trace contains a `page.goto` timeout before
the UI loaded. A prop capture case also timed out after an unexpected Vite page
reload. Both passed in a focused rerun; initial failures and rerun logs remain
in the isolated work directory. No product fix is attributed to those reruns.

Negative cases use `MaterialLibraryContext.test.tsx`, `materialEditLease.test.ts`,
and the native create/edit/instance suites for validation, metadata conflicts,
exact retries, missing originals and cleanup. They complement the recorded
happy paths and do not imply equivalent native fault injection during filming.

Native Windows screenshot recording remains blocked by the current remote
desktop: Midscene 1.13.3 reports `CopyFromScreen: The handle is invalid`.
Per-window recording works. No native screenshot success or Windows clipboard
integration is claimed. C18 is explicitly a browser fixture recording with
in-memory clipboard/persistence; capture cancellation, retry and suspicious-image
review have separate injected-boundary regression coverage. The main 0.0.19
walkthrough and GIF remain unchanged.
