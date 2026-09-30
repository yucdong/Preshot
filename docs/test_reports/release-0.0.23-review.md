# 0.0.23 code review and functional acceptance

This is baseline evidence. The installed W02 recording later exposed a Settings
layering defect and a dark gallery contrast issue; the final corrections,
replacement recordings and installer are tracked in the
[0.0.24 acceptance report](release-0.0.24-review.md).
Canonical walkthrough links now point to the current 0.0.24 media. The 0.0.23
raw takes, PDF, encoded media and hash inventory are retained in the isolated
baseline archive; measurements in this report describe that baseline only.

## 1. Task understanding

Review the application by subsystem, reproduce defects before fixing them, and
exercise user stories through the real UI. Produce fresh, captioned recordings
from a clean isolated workspace, publish source and media to Git, and build an
x64 MSI. Include the revised three-photo Nanjing/model sample and read-only
enlarged image preview. Evidence is retained in
`.preshot-build-cache/review-0.0.22`; existing bug lists and user data are preserved.
The evidence directory keeps its original review name. The final package target
is 0.0.23: the already-installed 0.0.22 review baseline requires a newer version
for a normal MSI upgrade. Final 0.0.23 package verification is complete below.

## 2. Risk and priority

P0: project save/copy, original-image integrity, material transactions, undo,
export completeness and deletion ownership. P1: routing, startup paths, image
presentation, resizing/cancellation, pagination, accessibility and localization.
P2: recording quality and documentation. There is one local application user
role; installer elevation is distinct from normal non-elevated application use.

## 3. Core functional coverage

Review React/domain/native boundaries, asynchronous state, persistence and
recovery, file ownership, schema compatibility, and production exporters.
Browser integration uses production UI with explicit platform fixtures; native
file/database tests use temporary roots. Packaged UI checks use a separate
profile and real dialogs. No test uses the real clipboard or modifies real
projects. Destructive install/upgrade/repair/uninstall testing belongs in a VM.

## 4. Key scenario list

| Story | Priority | User action and expected outcome | Evidence |
| --- | --- | --- | --- |
| S01 | P0 | First launch chooses one work root; remembered paths survive restart; cancellation does not switch data | Storage UI and native profile regressions; packaged startup |
| S02 | P0 | Create a named project in a chosen parent, edit and save; reopen with the same contents | Workspace UI; fresh recording |
| S03 | P0 | Switch open projects without reload, close with save/discard/cancel, copy latest contents independently | Workspace/copy UI, native copy and hash tests |
| S04 | P0 | Remove from list or confirm disk deletion without deleting another project | Project-delete UI and native ownership tests |
| S05 | P1 | Author text, lists, tables and cards; insert at the bottom; drag to columns and undo | BlockNote, menu, alignment and multi-column UI |
| S06 | P0 | Import images in a group, see progress, resize/crop/fit/reorder with one undo step; cancel safely | Image/group UI, focused regressions, native media tests |
| S07 | P1 | Double-click opens a read-only image; canvas crop remains available | Preview component/browser checks; new M08 recording |
| S08 | P0 | Create each material kind with pictures and metadata; duplicate-name confirmation and discarded drafts are safe | Create/editor UI; native library tests |
| S09 | P0 | Save document content as a material; insert all/subset as gallery or individual images; append to a group | Material insertion UI/native tests |
| S10 | P1 | Search, filter, favorite and page; editing, recycling and restoring leave a reachable list | Library UI, pagination regressions and recording |
| S11 | P0 | Export PDF/DOCX/long image preserving columns, images, crops and text; open actual PDF | Export integration, generated-file checks and recording |
| S12 | P1 | Switch language/theme, resize the window, use keyboard and IME without losing input | Language/theme/layout/UI regressions |
| S13 | P0 | Recover from missing/corrupt images, stale versions, failed saves and interrupted operations without false success | Native and domain/component fault regressions |
| S14 | P1 | Native capture cancel/retry/review; paste through an isolated clipboard boundary | Capture/clipboard UI; successful OS capture requires a separate manual clipboard check |

## 5. Execution notes

All Playwright runs specify an ignored output directory; the default
`test-results` directory contains user-authored bug reports and is not disposable.
Recordings start only after fixes pass their targeted checks. Fresh workspaces
contain no old projects; prepared demonstration materials are created through
the UI. Retain raw takes and failed-take evidence separately from published media.
Record actual pass/fail/blocked outcomes below; an automated boundary test does
not establish Windows clipboard, screen capture or installer lifecycle success.

## 6. Open questions

No product decision is required. Desktop screen capture availability, signing,
and a clean-VM installer matrix are environmental checks, not assumed passes.

## Results

### Confirmed defects and changes

| Area | Reproduction and resulting behavior |
| --- | --- |
| Native copy ownership | An exclusive destination collision could cause caller cleanup to delete a pre-existing file. Cleanup now runs only after this operation successfully creates its output; durable receipt-backed copies retain their recovery contract. |
| Preview cache | A PNG with valid dimensions but damaged pixel data stayed broken after Retry. Cache validation now reads rows and checksums before reuse, then regenerates damaged derivatives from the unchanged original. |
| Camera photos | EXIF rotation/mirroring was ignored by file-backed previews. New nonidentity imports preserve an explicit display-axis policy and separate display dimensions, without modifying original bytes or raw immutable library metadata. Legacy crops keep raw axes. |
| Image resize | Escape, blur, project deactivation and unmount could leave a drag alive; release could commit stale coordinates or another pointer. Image/group gestures now cancel or commit once using the owning pointer's final position. |
| Fit and undo | Resize followed by a cover/stretch change could make Undo fail with a stale plan revision. Fit changes now participate in the same real editor history boundary. |
| Card divider | Release could lag the pointer, swapped image/text order reversed arrow-key behavior, and inactive drags could commit. Divider updates now honor final coordinates, visual order and cancellation. |
| Library pagination | Deleting, restoring or unfavoriting the only result on page two exposed an empty page 2 / 1. The browser returns to a populated valid page after the authoritative search result. |
| Chinese input | Project creation/copy and first-launch path forms could submit or close during IME composition. Composition now completes before Enter/Escape can perform those actions. |
| Settings keyboard | The first Shift+Tab from the modal container could focus the background. Both navigation directions now remain inside Settings. |
| Folder reveal | A rejected open-directory promise surfaced an unhandled rejection after showing its error banner. The caller now consumes the already-reported failure. |
| Preview controls | Enlarged previews are read-only as requested. Canvas frame cropping, cover/stretch and resizing remain available; obsolete crop-toolbar tests/recording steps were updated. |
| PDF heading pagination | A bottom heading's following-space hint was attached to an inner Text node, whose wrapper hid later document siblings. The same bounded hint now belongs to the outer block wrapper; trailing headings and explicit page breaks retain their boundaries. |
| Test output | Default Playwright cleanup targeted the directory containing user bug reports. All three configurations now use separate ignored cache directories and retain failure screenshots/traces. |
| Restored material images | Undo restored the picture but its drag/selection readiness still read an effect-delayed image map. Readiness now uses the current render's image sources; a real drag-boundary regression covers deletion followed by Undo. |
| Development watcher and CSS scanning | Generated trace/profile files reached Vite's watcher, and Tailwind's repository-wide content scan included temporary production-harness JSON. Both could reload unrelated UI tests. Disposable roots are now ignored, dependency discovery is bounded, and Tailwind scans application sources plus explicit browser fixtures. Two failing-first regressions exercise the real filesystem watcher and actual Tailwind compilation while preserving genuine source changes and required utilities. |

EXIF-marked projects promote from schema 17 to 18 while retaining document v5.
The editor instance and undo history survive promotion; undo does not lower the
format barrier. Old files/receipts without the marker remain exact. Renderer,
drag, preview and export maps distinguish raw/exif views of the same original.
New marked portable materials use payload v2; older strict readers reject the
additional field rather than interpreting its crops incorrectly.

Individual failure regressions and focused checks passed before final packaging.
The 0.0.22 review baseline build and independent checks below are complete.
The final 0.0.23 build and package checks are complete.
Baseline browser acceptance and the main installed-app walkthrough are complete.
The focused series completed 31 native tutorials plus C18's browser fixture;
W02 exposed the later modal-layering defect. Final delivery uses 0.0.24.

### Final 0.0.23 validation and installed package

The 0.0.23 production validation log is `production-build-0.0.23.log` in the
review directory. The later `final-bundle-0.0.23.log` rebuild includes the final
PDF wrapper fix and generated-CSS scanning fix. Full Vitest was rerun after
those changes; the native source did not change after its 0.0.23 suite.

| Check | Result |
| --- | --- |
| Documentation, ESLint and TypeScript | Passed; production lint reported two existing Fast Refresh warnings and no errors |
| Final full Vitest | 195 files; 1,673 tests passed; 411.95 seconds (`vitest-complete.log`) |
| PDF mapping and actual renderer regression matrix | 41 tests passed (`pdf-heading-regression-after.log`) |
| Development watcher and Tailwind input isolation | Two tests passed (`vite-tailwind-after.log`) |
| Final full Playwright browser acceptance | 132 passed, 0 failed, 0 skipped, 0 retries; 834.04 seconds (`e2e-complete.json`) |
| Development-server stability during final browser acceptance | Zero HMR reload events (`e2e-complete-hmr.log`) |
| Initializer and production-script harnesses | Passed |
| Rust, explicit x64 target/all features/all targets/locked | 394 passed, 0 failed, 8 explained ignores; 140.97 seconds |
| Final frontend/native compilation and MSI bundling | Passed |
| Windows PowerShell 5.1 artifact/runtime/metadata audit | Passed; checksum and release JSON regenerated for the final files |
| Normal MSI upgrade from the installed review build 0.0.22 to 0.0.23 | Exit 0; exactly one current-family MSI registration and one Preshot uninstall entry remain |
| Installed EXE, DLL, sample and image worker | Passed the checks described below |

| Final artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Preshot_0.0.23_x64_en-US.msi` | 27,095,040 | `79de294f5562de2c9637c6af7c713e28cfc890bc5b94b515b88105d5b7bc5758` |
| Unbundled release `preshot.exe` | 37,933,568 | `e3a2d536c93844a49f9f3d7dc0c30f3c5f34287cddcee1936aa0627d466942e8` |
| Installed `preshot.exe` | 37,933,568 | `fe98a9011d085c8769ab77674bc685ecaf89e55d3d0f1ec504f510fbbbc087a2` |

The final ProductCode is `{862B4C7A-E9C2-4369-B53F-F9791B84CD1D}`; the stable
UpgradeCode remains `C91F6BC2-1F30-4D43-B878-3D09737227F2`. Read-only MSI API
enumeration and registry inspection confirm the old registration was replaced,
with the current package installed under `C:\Program Files\Preshot`.
The per-machine/x64/Program Files/HKLM/desktop-user launch and historical-family
contracts pass. No repair or uninstall was performed by this audit.

The installed EXE matches the build after normalizing only Tauri's three-byte
`MSI`/`UNK` bundle marker at offsets 29,860,418–29,860,420. The installed DLL
exactly matches the release DLL (SHA-256
`dbc2414e90e5f8690f208f52e864d392cdfbafafa541c6f41915ec97257e30a7`). All 17
installed sample files and notices match the repository. Location and model each
have three distinct original images; both props share one two-column row.
The actual installed hidden image worker passes raw/EXIF pixel orientation,
unchanged-original hashing, and corrupt-input/no-output checks without starting
Tauri, touching a profile or reading the clipboard.

Evidence: `artifact-integrity-0.0.23.json`,
`installed-artifact-integrity-0.0.23.json`, `installed-image-worker-0.0.23.json`,
and `install-0.0.23.log`. The final app/config/sample source snapshot covers 603
files in `source-integrity-0.0.23.json`, aggregate SHA-256
`deb7680df9c24a60b40608f69b4270360efc493e2079c35b9e028c42a7f963f3`.
It is a working-tree audit, not a reproducible-build claim. Metadata still names
the pre-publication Git HEAD and must be regenerated after the final commit.
The EXE/MSI are unsigned and remain non-publishable under the signed-release
contract. A clean-VM installer lifecycle matrix is still outstanding.

### Completed 0.0.22 review-baseline production validation

The successful `pnpm production:build` run is recorded in
`.preshot-build-cache/review-0.0.22/production-build-final.log`.

| Check | Result |
| --- | --- |
| Documentation, ESLint and TypeScript | Passed |
| Vitest | 195 files; 1,669 tests passed; no failures |
| Initializer regression harness | Passed all four reported command/version-boundary checks |
| Production script harness | Passed |
| Rust, `--target x86_64-pc-windows-msvc --all-features --all-targets --locked` | 394 passed, 0 failed, 8 ignored; main library run 125.76 seconds |
| Release frontend and native compilation | Passed; x64 MSI created |

The eight ignored Rust entries are five subprocess fixtures invoked by their
owning tests and three optional externally supplied large-image cases. They are
not eight unexplained feature skips. Separately, two real-large lifecycle tests
passed using a 300,221,278-byte PNG and a 262,894,203-byte JPEG: material
create/save/reopen/reuse/project insertion/derivatives and independent project
copy. That 797.88-second run used the native build after copy/cache fixes and
before the EXIF addition; it is not evidence for final-build large EXIF imports.
This full run includes the added EXIF regressions across all eight transforms,
all six material payload kinds, old raw-axis compatibility, crop, exact insertion
receipts and independent project copy.

The native independent-copy test was subsequently run from that same compiled
test binary with `PRESHOT_COPY_ACCEPTANCE_OUTPUT` set to an owned cache directory.
It passed and produced `native-copy-export-fixture` for the browser's real
PDF/DOCX/long-image exporter scenario, avoiding that scenario's optional-fixture
skip. The final browser scenario passed in 37.3 seconds and generated real PDF,
DOCX and long-image files. Evidence: `native-copy-export-fixture.log` and
`e2e-complete.json`.

### Final browser user stories and visual inspection

The complete 0.0.23 browser run passed all 132 tests without failures, skips or
retries in 13.9 minutes. It covers project creation/copy/cancel/retry, independent
source/copy sessions, both project deletion scopes, remembered startup roots,
language/theme, mounted-session history and scroll, native media save/reopen,
material creation/insertion/management, columns, image gestures and all three
production exporters. The material Delete/Undo/resize/keyboard-drag/save/reopen
chain and production-CSP thumbnail pixel check passed.

Earlier runs exposed the restored-image readiness defect and development-server
reloads. A read-only HMR observer identified Tailwind's bare `full-reload` event;
the dependency optimizer was unchanged. Temporary
`tests/.production-tools-*/package.json` files were being treated as CSS content
sources. Tailwind now scans `src` and explicit `e2e/fixtures` only, excluding
temporary documentation fixtures. Vite ignores generated output and bounds its
dependency entry discovery. The real watcher and compiled-CSS regressions both
failed before the final correction and passed afterward. The full rerun observed
zero reloads; no functional assertion was relaxed to obtain that result.

Screenshot inspection covered the bottom insertion menu in a 420px-high viewport
at 180% editor zoom, English category/menu sizing, mixed group/location alignment,
eight-direction image frames, swapped card regions with long text, wide material
images and the read-only lightbox. Required styles remained present after CSS
input scanning was narrowed. These are browser-shell checks with explicit native
fixtures; they do not establish OS clipboard or installer lifecycle behavior.

Evidence: `e2e-complete.log`, `e2e-complete.json`, screenshots/exported files under
`e2e-complete/`, `e2e-complete-hmr.log`, and the failing/passing
`vite-tailwind-before.log` / `vite-tailwind-after.log`.

### Independent 0.0.22 review-baseline MSI and installed-file checks

The supported Windows PowerShell `production-tools.psm1` checks independently
confirmed synchronized 0.0.22 versions, the expected release target, MSI file
identity, checksum/release JSON, and compiled runtime contracts. The package
uses ALLUSERS=1, x64 Program Files, HKLM registration, mandatory application
components, desktop-user `--from-installer` launch, and detect-only guidance for
historical installer families. These checks only inspect files and MSI tables.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `Preshot_0.0.22_x64_en-US.msi` | 27,095,040 | `03fc61a952b415efcc17ce891ada49d362ccac9e6f65733f1ebf34dad4a32c4b` |
| Unbundled release `preshot.exe` | 37,936,640 | `33b33fccd5aaf96a4917984f549d47f1d26144f8bddffbe81b04ee3ef883ef8c` |
| Installed `preshot.exe` | 37,936,640 | `e6eef1b4ad2dcce9bd4d6481c125066aa58d9d7cfcfc61bd046a2b2999a00cd6` |

The installed and unbundled executables differ at exactly three bytes:
Tauri's `__TAURI_BUNDLE_TYPE_VAR_MSI` versus `__TAURI_BUNDLE_TYPE_VAR_UNK` marker.
Normalizing that one marker yields byte-identical executables. The installed
`preshot_lib.dll` also exactly matches the release file. This expected bundling
difference must not be mistaken for a stale installed application.

After the normal MSI installation returned exit code 0, read-only comparison
confirmed all 17 installed Nanjing sample files and the third-party notices match
the repository byte for byte. Both the location and model contain three distinct
image hashes; the two props occupy one two-column row. Installation did not count
as a clean-VM repair/uninstall/reinstall acceptance matrix.

The actual installed executable's hidden image-worker entry was also exercised
without starting Tauri, a profile or clipboard handling. Raw output is 80 x 40;
EXIF Rotate90 output is 40 x 80 and exactly matches the transformed raw pixels.
The original hash is unchanged. A corrupt image exits unsuccessfully and publishes
no output. All three child processes completed; outputs are isolated cache files.

Evidence in `.preshot-build-cache/review-0.0.22`:
`artifact-integrity.json`, `installed-artifact-integrity.json`,
`installed-image-worker.json`, and `source-integrity.json`. The last file hashes
600 source/configuration/sample files from the working tree after compilation;
it is an audit snapshot, not a reproducible-build claim. Release metadata records
the build-time Git HEAD and must be regenerated after the final commit changes it.

### Main installed-app walkthrough and persistence

The final main take uses the installed 0.0.23 executable and a newly prepared
isolated profile. Five pictured materials were prepared through UI saves before
removing the starter project from that profile's list. Recording begins at the
empty launcher, creates a new project, writes the plan, inserts prepared
materials, drags the props into two columns, exports PDF and opens both pages in
Edge. Its last chapter creates another pictured material. Native file pickers
and visible UI controls perform these operations; no application IPC or database
writes enact the recorded workflow.

The saved plan has three distinct location photographs, three original mock
model illustrations, two props in one two-column row and ten independent
project-local images. Shooting notes cover timing, composition, exposure,
direction, weather, safety, field checks and delivery. The final PDF has two
pages, 1,597 extracted characters and ten image draws (six/four by page). Section
03 and both prop cards share page two; all image bounds are inside their pages.
Both pages were opened in the real reader and visually inspected.

MP4 and GIF are 57.5 seconds; the MP4 is 1280 × 900 and the GIF has 230 frames at
880px width. Full decoding and source/recording version checks pass. The public
PDF is byte-identical to the application export. The captioned contact sheet and
PDF pages were reviewed. See [main acceptance](demo-rich-acceptance.md),
[artifact hashes](media/demo-rich/artifacts.json), and
[contact sheet](media/demo-rich/contact-sheet.jpg).

Encoded-frame review caught a recording crop that clipped the app's top logo.
The original takes were retained and re-encoded with the full application header;
old media and crop metadata are archived. The explicit PDF-reader crop and
exported PDF bytes are unchanged. Failed UI Automation calibration takes are
also retained separately and excluded from the published tutorials.

Recording drivers now validate the owned cache/profile, installed executable,
process start time and child WebView data directory before interacting. Project
copy recording pins the source registry identity/path and checks the complete
copied plan before adding copy-only text. Thirteen isolated guard/parser checks
pass; the capture-cancellation driver's Windows PowerShell 5 encoding error was
reproduced and fixed with UTF-8 BOM. These are automation corrections, not app
runtime changes. Evidence: `native-driver-review.md` in the review directory.

After gracefully closing the owned app and reader, the read-only profile audit
passes: one project, six materials, eleven immutable library originals and ten
project-local originals; 23 files including manifests/database were hashed.
SQLite integrity and foreign keys pass, with no pending image-location rows or
uncheckpointed journals. Evidence: `main-final-profile.json`; raw takes/profile
remain under `.preshot-build-cache/demo-rich-0.0.23`. Real user data and the live
clipboard were untouched.

### Native verification limits and additional evidence

The later PDF heading regression failed before its wrapper correction and passed
afterward; the focused real-renderer mapping/export matrix passed 41 tests, with
ESLint and TypeScript passing. A headless production export of the existing rich
demo preserved all ten images, their dimensions and every non-whitespace text
character. Its heading moved to the props page as intended. That unchanged demo
now spans three pages because moving the 25.8-point heading displaced the final
credits paragraph from the previously full second page. No whole section was
made unbreakable. The newly authored installed-app demo above was subsequently
verified with two populated pages. Evidence: `pdf-heading-regression-before.log`,
`pdf-heading-regression-after.log`, `pdf-heading-main-comparison.json`, and the
rendered `pdf-heading-main-after-page-*.png` files in the review directory.

The copied native fixture's actual PDF has five A4 pages, checked by rasterizing
all pages with Poppler (`copy-export-visual/pdf-page-*.png` and
`copy-export-visual/pdf-contact.png`). The corrected short following-space
reserve is honored, but it does not reserve the full height of a taller,
indivisible gallery: the section 03 heading ends page three and its gallery begins
page four. Expected images and text remain present with no observed image
clipping. This is a pagination limitation, not a guarantee that a heading and
an entire gallery will always remain on the same page.

A separate, in-memory demo-authoring probe restores two pages without changing
global PDF geometry: leave the checklist after its third item, use ordinary
paragraphs for weather/handover/credits, and join weather and handover with one
space. All original non-whitespace text remains; the resulting PDF has ten
in-bounds images and 1,531 extracted characters (the old empty checkbox glyph and
extra line breaks disappear). Section 03 and both props share page two; the last
text ends at 806.79 points, inside the 817.89-point printable bottom. The source
profile was read only. Evidence: `pdf-heading-demo-flow.pdf`,
`pdf-heading-demo-flow.json`, and its page PNGs. The final installed recording
uses this paragraph structure and adds a field-communication paragraph; its
actual exported file is independently verified above.

Both EXE and MSI report Authenticode `NotSigned`. Release metadata correctly marks
this build non-publishable under the repository's signed-release policy; no
signature or clean-VM lifecycle pass is claimed.

`scripts/verify-demo-profile.py` is ready for the final closed recording profiles.
It reads SQLite immutably, rejects uncheckpointed WAL/journals and linked paths,
checks v10 identities/location ledgers and original hashes, audits project-local
references and schema-18 EXIF markers, and optionally compares independent project
copies. Its 17 isolated checks passed; an existing 0.0.20 tutorial profile validated
13 materials, 16 independent originals and two projects with no source-file changes.
Those old-profile results validate the verifier only. The fresh main 0.0.23
profile was subsequently checked separately as reported above.

Successful native screen capture launches Windows Snipping Tool and receives its
new image through the session clipboard. Restoring the visible desktop does not
remove that dependency. Unattended acceptance continues to avoid the live system
clipboard. `scripts/verify-native-capture-cancellation.ps1` therefore prepares
system Escape cancellation, starting again, and in-app cancellation using an
owned unsaved material draft. All three steps passed in the installed 0.0.23 app:
the real Snipping Tool appeared on both attempts, cancellation returned to the
draft, metadata and draft hashes were unchanged, no picture was inserted, and
owned-draft cleanup completed without errors. Evidence:
`.preshot-build-cache/material-tutorials-0.0.23/C13-cancel-retry/acceptance.json`
and its screenshots. No capture area was selected and the driver made no
clipboard API calls. Successful image capture remains outside this run; no
successful-capture tutorial is published.

The closed baseline tutorial profile passed three projects and 73 file hashes,
with independent source/copy originals and one copy-only text addition. The real
large-image UI chain and original correlation also passed; screenshot cancellation
is reported above. Raw evidence remains in the isolated recording directories.
The W02 layering and dark gallery findings led to the 0.0.24 correction and
normal upgrade. All 0.0.22/0.0.23 hashes here identify baseline artifacts, not the
final delivery. Final recordings, Git delivery and current package metadata are
tracked by the [0.0.24 report](release-0.0.24-review.md). Destructive installer
lifecycle coverage remains assigned to a clean VM.
