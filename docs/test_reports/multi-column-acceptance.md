# Multi-column acceptance

[Documentation index](../README.md) · [Editor guide](../features/editor.md)

## 1. Task understanding

Implement arbitrary finite sibling columns with relative widths, proportional
gallery rendering, persistence, library flows and PDF/DOCX/long-image export.
Single-column projects migrate from v15/document-v3 to v16/document-v4 without
regrouping content or changing image frames. Nested column rows are excluded.
The material editor stays one component.

Execution: 2026-09-29, Windows x64, Edge/WebView2, Chinese and English.
The installed journey uses a disposable profile/project/library under
`.preshot-build-cache/multi-column/native-profile`. Real user projects and the
user's library database are not test fixtures.

The latest source interaction is drag-only: the column toolbar and column slash
commands have been removed. The installed 0.0.8 evidence below predates this
refinement and still shows those controls. Subsequent installed drag-only and
bundled-sample verification is recorded in the
[installed demo acceptance](installed-demo-acceptance.md).

## 2. Risk and priority

- P0: persistence, unique image ownership, insertion/paste receipts, strict
  migration, undo/redo and cancellation.
- P1: column controls, scaled gestures, export layout, modal stacking and i18n.
- P2: dense rows. Arbitrary counts retain the 20,000-node/32-depth resource bounds.

## 3. Core functional coverage

The installed fixture contains a Nanjing bridge location, fictional Model A,
transparent umbrella, wardrobe, image group and text, using local JPEGs and
mock illustration PNGs. A location saved from the left column is inserted
after a user-focused paragraph in the right column. It owns a fresh artifact ID
and `references/0007.jpg`, independently of `references/0001.jpg`.

Automated fixtures cover unequal widths, empty groups, mixed frame sizes,
crop/stretch, signed offsets, duplicate pixels with distinct identities, stale
receipts, invalid nesting and all five library payload kinds. Real editor
history and production export libraries are used. Platform I/O is injected for
unattended clipboard/capture tests.

## 4. Key scenario list

| ID | Priority | Story and observed checks | Result |
| --- | --- | --- | --- |
| MC-01 | P0 | Validate legacy input, migrate, persist v16/doc4, reopen with relative image paths and sidecars | Passed: domain/service and original browser migration suite |
| MC-02 | P1 | Create/add/merge columns without a preset count cap | Passed: schema 2/3/4/12/32/80; browser 2 through 12; installed 2 → 3 → 2 |
| MC-03 | P0 | Move text/cards/groups, duplicate descendant sidecars, merge, undo/redo and reopen | Passed: real editor operations, browser cross-column drag, native material journey |
| MC-04 | P1 | Change column width without rewriting frames/crops; preserve row order and scale | Passed: geometry tests, browser preview/release/undo, installed two/three-column photos |
| MC-05 | P1 | Resize images in scaled columns, cancel divider drag, undo image resize | Passed: browser 70%/100%/130%; edge preserves height; resize records one history step |
| MC-06 | P0 | Save in-column material, insert at a real cursor in another column, undo/redo/restart | Passed: installed location journey; native all-kind insertion, receipts, tampering rejection and retained files |
| MC-07 | P0 | In-column image capture cancels and retries; paste cannot alter unrelated weights | Passed with injected platform boundaries; native receipt tests use temporary files. Physical snip completion remains manual |
| MC-08 | P1 | Export mixed/tall columns; inspect assets, duplication, safe boundaries and narrow-column errors | Passed: real PDF/DOCX/JPEG output and native save dialogs; tall PDF and common-cut tests |
| MC-09 | P1 | Chinese/English controls, keyboard history, inactive editor isolation, modal layering | Passed: browser/component coverage and installed language switch/settings overlay |
| MC-10 | P0 | Reject orphan columns, malformed rows, nesting, bad weights and duplicated ownership | Passed: schema/native validation and editor transaction guard |
| MC-11 | P1 | Build MSI, install, modify/save and restart installed executable | Passed on development workstation; final artifact verification recorded below |

## 5. Execution notes

### Drag-only interaction refinement (2026-09-29)

Users create columns by dragging a block's six-dot handle to another block's
left/right insertion line. Further edge drops add sibling columns. Divider
dragging changes widths; moving the last block out removes that empty column,
and one remaining column unwraps into ordinary document flow.

- Real browser interactions: **7 scenarios passed**. Coverage includes creation,
  adding/removing columns, divider preview/commit/undo/redo, save/reload, gallery
  scaling, image moves between columns, image resizing at different zoom levels,
  settings layering and real PDF/DOCX/long-image downloads. Escape and outside
  release both cancel without changing the saved document; the next drag works.
  Log: `.preshot-build-cache/multi-column/drag-browser.log`.
- Focused editor regressions: **3 files / 15 tests passed**. Failing cases added
  before fixes cover empty-column cleanup with undo, atomic blocks dropped in
  column blank space, and cancellation occurring exactly once when the document
  changes before release. The final cancellation browser scenario was rerun
  after that fix and passed.
  Logs: `drag-unit.log` and `drag-cancel-browser.log` in the same cache directory.
- TypeScript, ESLint, i18n (**815 UI messages**), documentation links and diff
  whitespace checks passed.
- Inspected [two-column](media/multi-column/drag-two-columns.png) and
  [three-column](media/multi-column/drag-three-columns.png) screenshots: no column
  toolbar, contained gallery frames, proportional scaling and wrapping actions.
  These browser fixtures use black one-pixel images for geometry checks; the
  installed screenshots below provide the separate photographic-asset baseline.

### Initial implementation automated results

- Full frontend baseline: **178 files / 1,543 tests passed**.
- Subsequent capture/frame-history changes: **5 files / 65 tests passed**,
  covering provider, gallery, crop, drag and frame history. Final result:
  `.preshot-build-cache/multi-column/final-frame-regression.log`.
- Native full suite: **316 passed, 5 pre-existing ignored**; includes column
  insertion/paste journeys. No production clipboard was used as a fixture.
- Original BlockNote browser scenarios passed across the initial run and
  focused reruns. Two old v15 assertions were updated to v16; startup failures
  were rerun. This was not one uninterrupted clean run.
- New multi-column browser suite: **6 passed**, including 70%/130% image resize
  and undo. Log: `.preshot-build-cache/multi-column/acceptance-browser.log`.
- TypeScript, ESLint, i18n (827 messages), documentation links and the
  production-script harness passed. Production build also runs TypeScript.
  The existing large-chunk build warning is non-fatal.

### Defects found and retested

1. PDF/DOCX structural mapping initially emitted descendants twice. Containers
   now consume them exactly once; real PDF draw counts/DOCX drawings are asserted.
2. The upstream divider extension wrote non-history edits during drag. Preview
   now changes DOM weights only; release commits one history step. Escape,
   pointer cancellation, blur and document mutations cancel it.
3. Old gallery toolbar stacking escaped the settings backdrop inside columns.
   Obsolete positioning was removed and columns establish a stacking context.
   Browser and installed executable were checked.
4. Image frame resizing did not enter editor history. Resize now records the
   affected image, retains unrelated document changes, rejects stale ownership
   and restores editor focus on release. Failing 70%/130% undo cases now pass.
5. Old browser migration/rejection assertions expected schema 15; updated to 16.

### Installed 0.0.8 baseline and visual evidence

The installed journey saved/reopened two columns, four original artifacts and
one image group. Material insertion adds a fifth artifact and seventh independent
image file. Save/undo/redo retain valid structure and ownership.

- [Installed editor](media/multi-column/installed-editor.png)
- [Three-column gallery scaling](media/multi-column/installed-three-columns.png)
- [Material library thumbnail](media/multi-column/installed-library.png)
- [Settings overlay after the fix](media/multi-column/installed-settings.png)
- [Installed image resize and redo](media/multi-column/installed-image-resize.png)
- [Rendered PDF page](media/multi-column/export-pdf.png)
- [Actual exported JPEG](media/multi-column/export-long-image.jpg)

The inspected PDF contains one A4 page and seven image draws: two locations,
model, umbrella, two group images and wardrobe. DOCX contains a three-cell row
(two columns plus spacer), six drawings (the two-photo group is composited) and
four embedded media assets after format-level deduplication. JPEG:
**900 × 1407**, **83,014 bytes**. Images stay inside their respective columns.

Baseline artifact: **Preshot_0.0.8_x64_en-US.msi**, built for
`x86_64-pc-windows-msvc`, installed with exit code 0; installed file version 0.0.8.
The installed executable matches the build except the expected Tauri bundle-type
marker (`MSI` in the package, restored to `UNK` after bundling); the library DLL
matches byte-for-byte. Hashes are in
`.preshot-build-cache/multi-column/final-artifact.json`.

On the final installed binary, dragging the location image's right edge changed
its frame from 300 × 200 to 348.1126 × 200. Ctrl+Z restored 300 × 200 and
Ctrl+Shift+Z restored the resized frame. Every step saved successfully; the full
column document, other galleries/artifacts and SHA-256 of all seven original
reference files stayed unchanged. The fixture was restored after this check.

The installer is an unsigned local verification artifact, not a published release.
Logs and installed-file verification are retained in `.preshot-build-cache/multi-column`.

## 6. Remaining manual coverage and product limits

- The system snipping tool was invoked/cancelled during the installed check,
  but successful physical screen selection was not certified. The repository
  requires unattended tests to avoid the live system clipboard. Cancellation,
  retry and save instead run through the real capture adapter with injected
  native responses, including an image inside a column.
- DOCX package structure and embedded images were checked; visual pagination
  in Microsoft Word was not certified on this workstation.
- Clean-VM install/upgrade/repair/uninstall remains separate release acceptance;
  the destructive matrix is excluded on the developer PC.
- Dense columns scroll horizontally. Fixed-width exports reject
  columns narrower than 48 logical units after gaps; DOCX observes its 63-cell
  limit including spacers. No silent clipping or automatic regrouping.
- New v16 saves require this version; older releases cannot open them.

There are no known remaining failures in the exercised workflows. The manual
checks above are limits of this acceptance, not claimed passes.
