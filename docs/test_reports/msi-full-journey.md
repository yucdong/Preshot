# Installed Windows application: user stories and acceptance record

[Documentation index](../README.md)

## 1. Task understanding

Exercise the shipping, MSI-installed application through its visible Windows UI,
using a Nanjing Yangtze River Bridge portrait plan. Inspect both behaviour and
screenshots, fix confirmed defects, then record the final workflow and build a
versioned MSI. Browser fixtures and unit tests supplement native evidence; they
do not count as installed-application acceptance.

Baseline: 0.0.5 x64, Windows development workstation, 150% display scaling.
All native data is isolated under `.preshot-build-cache/msi-full-regression`;
the installed executable remains in `%LOCALAPPDATA%\Programs\Preshot`.
Fictional Model A, bridge photographs, transparent umbrella and bubble-machine
illustrations come from the credited [demo assets](../demo/README.md).

**Current disposition: native full-journey acceptance is blocked.** The remote
Windows session is disconnected. Automated checks and the refreshed browser
walkthrough below are complete; they do not establish a passing native UI run.
The requested final Git push and new MSI remain pending native acceptance.

## 2. Risk and priority

- **P0:** durable saves, independent image ownership, material save/reopen,
  insertion/undo, export pixels, cancellation and retry.
- **P1:** all visible editing controls, search/recycle, project switching,
  localization, layout, screenshot capture, installer identity.
- **P2:** presentation polish, invalid input and boundary feedback.

The app has one local-user role and no server permissions. Test writable
isolated directories plus native error/cancellation paths. Do not modify the
developer's real library/projects, use the live clipboard, or run destructive
installer repair/uninstall experiments on this workstation.

## 3. Core functional coverage

| Story | User objective | Acceptance |
| --- | --- | --- |
| US1 | Organize several photography projects | Create/open/switch/save/close/restart without lost work |
| US2 | Write a useful shooting plan | Text, formatting, structured blocks, components and undo work |
| US3 | Collect and arrange visual references | Import, capture/cancel/retry, resize/crop/fit, groups and history preserve images |
| US4 | Build a reusable offline material library | All five categories, metadata/search, independent originals, preview and editing work |
| US5 | Reuse and manage materials | Full/partial insertion, insertion target, undo, favorites, recycle/restore/purge work |
| US6 | Share a finished plan | PDF/DOCX/long images preserve text, images and ordering; open actual exported files |
| US7 | Adapt the workspace | Chinese/English, light/dark/system, rail/focus/zoom persist without corrupting content |
| US8 | Install and revisit the app | Correct MSI/executable, isolated first launch and existing-data restart work |

## 4. Key scenario list

The status column below refers to **native acceptance**, not automated coverage.
`pending` means blocked by the disconnected desktop. Native means visible actions on the installed binary;
automated means a separately identified regression harness. Evidence filenames
refer to the isolated work directory unless linked to a committed screenshot.

| ID | Pri. | Concrete actions and expected result | Status / evidence |
| --- | --- | --- | --- |
| P01 | P0 | First launch creates starter; new project uses one name/parent dialog and creates the previewed path | pending |
| P02 | P1 | Cancel creation; invalid/duplicate names give feedback and retain input | pending |
| P03 | P0 | Edit two open projects, switch back; content/history retained without reload | pending |
| P04 | P0 | Close project: cancel keeps it open; save-and-close persists; discard closes safely | pending |
| P05 | P0 | Reopen from disk and restart installed app; files/images survive | pending |
| P06 | P1 | Reveal directory/remove list entry; underlying project is retained | pending |
| P07 | P1 | Open compatible legacy plan; reject unsupported schema without partial editing | pending |
| E01 | P0 | Write Chinese heading, paragraph, shot list; undo/redo and explicit save | pending |
| E02 | P1 | Slash menu: lists/checklist/table/quote/divider, formatting and row actions | pending |
| E03 | P1 | Location/model/props cards: edit fields, add sample image, responsive layout | pending |
| E04 | P1 | Import image/video/audio blocks; save and reopen with project-owned relative paths | pending |
| I01 | P0 | Image upload; source unchanged, relative project-owned media, image displays after reopen | pending |
| I02 | P1 | Upload/embed/screenshot share one row; unavailable URL fails actionably | pending |
| I03 | P0 | Cancel screenshot with Esc; immediately retry, select region and save image | pending |
| I04 | P1 | Image selection, preview, crop, cover/stretch, frame resize/remove/undo | pending |
| I05 | P0 | Import group images; reorder within/between groups, cancel outside and undo | pending |
| I06 | P0 | Clipboard import/copy, independent files and history in isolated clipboard harness | native boundary harness passed; installed UI pending |
| L01 | P0 | Save selected project image to library with Chinese metadata and tags; thumbnail/full preview render | pending |
| L02 | P0 | Directly create image, group, model, location, props materials with sample images; first save closes | pending |
| L03 | P0 | Edit existing material, save repeatedly, discard later edits; committed images survive reopen | pending |
| L04 | P1 | Empty/duplicate name, cancel create, draft with no image, save failure do not lose data | pending |
| L05 | P1 | Search Chinese/literal text/tags, filter five categories/favorites, lazy full preview | pending |
| L06 | P0 | Insert individual image after focused row; undo/redo; independent Image block | pending |
| L07 | P0 | Insert full group and selected one/multiple images, as group or separate images | pending |
| L08 | P0 | Group toolbar library picker appends image or selected group images into current group | pending |
| L09 | P0 | Insert model/location/props; new copies survive source changes/deletion | pending |
| L10 | P1 | Recycle, restore, permanent-delete confirmation/cancel; project copies survive | pending |
| X01 | P0 | Export PDF via native save dialog; open actual PDF and inspect every page | pending |
| X02 | P0 | Export DOCX; inspect document XML/embedded images and rendering where available | pending |
| X03 | P0 | Long image JPEG/PNG, default split off, open image and inspect pixels | pending |
| X04 | P1 | Export dialog cancel, split setting reset, long-document split and safety-limit feedback | pending |
| S01 | P1 | Switch English/Chinese; category icons and labels remain readable, content unchanged | pending |
| S02 | P1 | Light/dark/system, focus/rail width, zoom; screenshot at normal and narrow width | pending |
| S03 | P1 | Restart preserves preferences and document; corrupt settings recover in isolated fixture | pending |
| M01 | P0 | Verify MSI/executable version, per-user x64 install and checksums | passed for installed 0.0.5; details below |
| M02 | P1 | Upgrade/restart preserves test data; clean-VM repair/uninstall remains separate qualification | pending |

## 5. Execution notes

For each defect, retain the observed screenshot, write a failing focused
regression, fix the narrow cause and repeat the affected native journey on an
updated MSI. Run the repository validation matrix before delivery. Keep actual
native coverage, automated-only coverage, and environmental gaps distinct.

### Execution log (2026-09-28)

- Started the installed 0.0.5 executable with a fresh isolated profile. The
  Windows session was disconnected (`query session`: session 2, `Disc`).
  `001-startup.png` and `002-ready.png` contain the window frame and a blank
  WebView. These are **blocked observations**, not passing startup evidence or
  a confirmed application defect. Requested an unlocked, connected desktop.
- Documentation, lint, TypeScript and bilingual-catalog checks passed before
  the full test run. The catalog contains 815 UI messages.
- **D01 — walkthrough recorder waits for obsolete first-save UI:** the original
  recording failed at `record-demo.mjs` after creating the first location
  material. It waited 20 seconds for the existing-material success message,
  although the new-material editor had correctly closed. The saved failure
  screenshot shows the location card and its bridge thumbnail in the library.
  Changed the recorder to assert editor closure and the new library item.
  This is a recording-tool defect, not another material-persistence failure.
- **D02 — two end-to-end tests still expect the old first-save behaviour:**
  `material-category.spec.ts` and `material-gallery-insert.spec.ts` failed before
  modification. Both now assert that creation closes the editor and publishes
  the named item. Existing-material editing still asserts continued editing.
  Both complete journeys passed after the change, including merged-category
  search and insertion from the library into project/material image groups.
- One recording attempt lost its preview dialog before the close action. A
  repeat with top-level navigation logging completed successfully; no application
  defect or root cause was established. Retain `recorder-after-fix.log` and
  `recorder-final.log` rather than treating the interrupted run as acceptance.
- The completed recording exported a real three-page PDF and opened every page
  in Edge. Inspected the final MP4/GIF, chapter alignment, model/prop images and
  PDF closeups. Final playback is approximately 119 seconds (MP4: 6,075,224 bytes;
  GIF: 12,077,743 bytes). Caption times were aligned to captured frames, preserving
  normal-speed PDF review. Media are linked from both READMEs.

### Automated results

| Check | Result | Scope / evidence |
| --- | --- | --- |
| Documentation, ESLint, TypeScript, i18n | passed | 815 bilingual UI messages |
| Vitest | 1,527 passed, 174 files | Domain/component/adapters, save/recovery/CAS, export/geometry |
| Initializer and production scripts | passed | Error exit codes, prerequisite boundaries, version/build/metadata contracts |
| Rust | 312 passed | Temporary-root native persistence, library instances/ownership, transactional insertion, purge/recovery, exports; five private subprocess fixtures are intentionally ignored as standalone tests and exercised through their parent tests |
| Playwright release suite | 79 passed initially; two stale assertions failed and then passed after repair | 81 scenarios now have passing results; this is a combined baseline + focused rerun, not a new clean full-suite run |
| Dedicated BlockNote suite | 16 passed | Editor, row/image drag, artifact layout, native-media serialization, legacy migration, production PDF/DOCX/long-image pipelines |
| Demo journey | passed after recorder repair | Project creation → document → illustrated materials → search/preview → insertion → settings → PDF export → actual PDF reader |

The initial `production:verify` command stopped on the two stale end-to-end
assertions. Its later artifact-verification stage therefore did not run; do not
describe that command itself as passing. Focused reruns and the dedicated
BlockNote run are recorded separately in `focused-e2e.log` and
`blocknote-e2e.log`.

Automated coverage includes schema-v13 migration and schema-v12 rejection;
image/video/audio save/reload; cached project sessions; single-dialog project
creation; close cancellation/save; screenshots through injected platform
boundaries; all five material categories plus legacy clothing; crop and image
ownership; duplicate-name/unknown-save recovery; Chinese/literal search;
metadata CAS/recycle/purge; partial and independent-image insertion; document
cursor targeting and undo/redo; bilingual/size/theme layouts; and offline PDF,
DOCX ZIP/XML, pasted-image pixels, 6,000px and 20,000px capture boundaries.
These checks do not replace Windows file-picker, screen-snipping or installed
WebView interaction tests.

### Installed artifact identity

- MSI: `Preshot_0.0.5_x64_en-US.msi` (23,130,112 bytes), SHA-256
  `f30e619011926761c4561c04c4bc515097da6d8e033c1d14dc3cca2f72f002e7`.
- Installed EXE reports 0.0.5, SHA-256
  `5cbd14aedf5935e61a0372483cc0908f84d238a02148cb4bf0250e718565193f`.
  Its bytes equal the release EXE after normalizing Tauri's MSI bundle marker.
- Source: `d95ba2d9ba6cef55d3f6f90ee7ef1fb7fe50d46a`.
- Read-only `MsiGetProductInfoEx` confirms context 2 (per-user unmanaged);
  contexts 1 and 4 return unknown product. HKCU application registration points
  to `%LOCALAPPDATA%\Programs\Preshot`. No repair/uninstall was run.
- Earlier installed material save/edit/restart evidence is in the
  [0.0.5 report](msi-0.0.5-material-library.md). It remains valid for those narrow
  cases; it is not evidence for the additional native scenarios above.

### Screenshot review

Reviewed 52 browser-harness screenshots plus the demo's illustrated materials,
all three PDF pages and final captioned recording. No additional obvious visual
defect was confirmed. Local `visual-index.json` and five contact sheets preserve
the full review index. Representative evidence below is explicitly **browser
fixture / real PDF output**, not MSI screen captures.

| Evidence | Observation |
| --- | --- |
| [English category](media/full-journey/english-category.png) | Props and wardrobe icon retains its size; wrapping label and actions remain legible. Also reviewed Chinese/English at 390, 760, 1000 and 1280px. |
| [Dark editor](media/full-journey/dark-editor.png) | Metadata, footer and tools remain readable; the document surface intentionally stays white. |
| [Group insertion](media/full-journey/group-insertion.png) | Six copied images wrap into rows inside the existing group; no extra Image blocks appear. |
| [Capture panel](media/full-journey/capture-panel.png) | Upload, embed and screenshot are on the same row. The actual Windows overlay remains unverified in this run. |
| [Illustrated Model A](media/full-journey/demo-model.png) | Text fields and sample portrait fit in the component; save action is visible. |
| [Exported PDF page 2](media/full-journey/demo-pdf.png) | Bridge/model/umbrella images render; text stays in its column and short cards remain intact. Page 3 contains the bubble machine. |

Local logs: `production-verify-baseline.log`, `recorder-before-fix.log`, and
`recorder-after-fix.log`. Retain raw recordings and screenshots locally; commit
only reviewed, relevant evidence.

## 6. Open questions and environment limits

No product decision is needed to begin. Public release signing and clean-VM
installer qualification are separate from this local build/push request.
Clipboard automation must use a private window station. Remote URL availability
depends on network access; offline local imports are the primary export path.
Resume native execution after reconnecting and unlocking the development
desktop. Finish the pending scenarios, retest any product fixes in an updated
MSI, then complete the authorized Git push and final MSI build. Do not mark this
record as a full native pass until that evidence exists.
