# 0.0.24 code review and installed acceptance

This report completes the repository review first exercised on 0.0.22/0.0.23.
The [baseline review](release-0.0.23-review.md) contains the subsystem findings,
fourteen user stories, original-file integrity tests and detailed failure
evidence. Existing user projects, the real library and live clipboard are not
test fixtures. All recording and persistence work uses isolated profiles.

The 0.0.24 bundle, normal upgrade, installed file/worker checks and all 134 browser
tests have passed. Final recordings and their profile/media audits are described
below. Results distinguish baseline evidence from this build.

## Review findings and final corrections

The earlier fixes preserve independent file ownership, regenerate damaged
preview caches, handle camera orientation without changing originals, correct
image/divider cancellation and Undo, restore image readiness after Undo, recover
material pagination, protect IME input, retain Settings keyboard focus and
handle reveal errors. Enlarged previews are read-only; canvas crop-to-fill,
stretch and resizing remain. PDF heading hints now apply at the block wrapper.
Generated testing/recording files no longer reload the development editor.

Installed recording uncovered two further defects that browser smoke checks
had not previously exercised:

| Defect | Reproduction | Correction and regression |
| --- | --- | --- |
| Settings pointer interception | A selected native image's transparent right resize edge lies beneath the Light button. Both a real desktop click and a browser mouse click hit the image instead of Settings. | Native image controls now stay within a local stacking context. The physical-click regression changes theme and verifies that all image properties remain unchanged. |
| Dark gallery labels | A standalone image-group title used paper colors on BlockNote's dark surface: title contrast 1.07:1; count 3.09:1. | Standalone headings/counts use BlockNote theme colors. Computed-contrast checks cover light/dark surfaces and preserve the paper colors of embedded card galleries. |

Both regressions failed before the CSS correction. Runtime changes after the
0.0.23 bundle are limited to these styles and the synchronized package version.
Evidence: `settings-layer-red.log`, `gallery-contrast-red.log`,
`settings-gallery-final.log` and `settings-gallery-affected.log` under
`.preshot-build-cache/review-0.0.22`.

## Validation

| Check | Scope and result |
| --- | --- |
| Baseline full Vitest | 195 files / 1,673 passing tests on 0.0.23 before the final CSS-only correction |
| Baseline full Rust | 394 passed, 8 explained ignores; native logic is unchanged in 0.0.24 |
| Baseline full browser suite | 132 passed, no skips/retries or HMR reloads |
| Final targeted browser checks | 14 passed: both new regressions, image gestures/cancellation/Undo, material galleries/cards and all three exporters |
| Final focused Vitest | 13 passed: Settings, native images and editor language behavior |
| Final typecheck and ESLint | Passed; ESLint has no errors and two Fast Refresh organization warnings in the image block specification |
| Production-script regression harness | Passed |
| Final full browser suite | 134 passed, zero failures/skips/retries; 810.70 seconds |
| Development-server stability | Zero HMR updates and zero full reloads throughout the final suite |
| Explicit x64 frontend/native/MSI build | Passed; before/after source fingerprints agree |
| Normal 0.0.23 to 0.0.24 upgrade | Exit 0; one matching current-family product and one uninstall entry |
| Installed files and hidden image worker | Passed; EXE/DLL, 17 sample files, notices and raw/EXIF/corrupt decode checks |
| Preservation across upgrade | 73 previously audited isolated files / 1,138,343,080 bytes unchanged |
| Final recording helper regressions | 9 PowerShell scripts parsed; 14 ownership checks, 5 capture-loop checks, 8 popup-frame checks and 8 frame/FFmpeg checks passed |

The eight baseline Rust ignores are five subprocess fixtures invoked by their
owning tests and three optional external large-image cases. Separate real-large
tests were run; these are not unexplained feature skips. The final CSS changes
are covered by actual browser hit-testing and computed colors, rather than
assuming a DOM-only unit test establishes pointer layering or contrast.

The final browser run covers workspace creation/copy/deletion and recovery,
loaded-session behavior, all material types and insertion modes, image
clipboard/capture boundaries, real Undo/Redo, columns, layout, language/theme,
and the three production exporters. Screenshot review includes narrow English
dialogs, bottom menus at device pixel ratios 1/1.5/2 and 180% editor zoom,
wide image controls, dark/light galleries and the corrected Settings hit target.
Browser pixel-ratio emulation is distinct from native Windows display scaling.
The copied native fixture exported actual PDF, DOCX and two PNG parts; all expected
images/text remain present. The PDF pagination limit below is preserved in the
report rather than treated as a perfect-pagination result. Evidence:
`e2e-final.json`, `e2e-final.log`, `e2e-final-hmr.json`,
`copied-export-visual/export-inventory.json` and `e2e-final-review.md` in the review directory.

## Installer

The current WiX contract deliberately excludes equal versions from major-upgrade
detection. Rebuilding 0.0.23 would create a different ProductCode without safely
replacing its installed copy. The final build therefore uses **0.0.24** and the
existing normal upgrade path; no same-version override or installer policy was
introduced. The 0.0.23 MSI, EXE, DLL and metadata are archived with verified hashes.

The new artifact is
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Preshot_0.0.24_x64_en-US.msi`.
The 603-file before/after source fingerprint is
`1b72cb8b8e2a8bf41f63b347d487a37927265f43f197a2827790a9d934815d1e`.
This is a working-tree integrity audit, not a reproducible-build claim.
Build and final artifact evidence is retained under
`.preshot-build-cache/review-0.0.24`.

The MSI is **27,095,040 bytes**, SHA-256
`8e96503aa3fb50f266ea24ff13ec6fe83e23d8ffbf3e1863f090b1fbd560cece`.
Its ProductCode is `{D186203E-5DA9-458A-A891-2FDB3F67DF0D}` and stable UpgradeCode
is `C91F6BC2-1F30-4D43-B878-3D09737227F2`. The normal upgrade completed with exit 0
and no separate uninstall, application launch or restart.

The installed EXE matches the release EXE after normalizing only Tauri's expected
three-byte `MSI`/`UNK` marker. The installed DLL matches exactly (SHA-256
`930e7dad93703d0da77a07d585e21955533644fb13a82f99b2dcdeaf225af605`). All installed
sample files/notices match; each location/model gallery has three distinct
originals and the two props share one two-column row. The hidden image worker
passes exact raw/rotated-pixel and corrupt-input checks without initializing a
profile, GUI or clipboard. Evidence: `artifact-integrity-0.0.24.json`,
`installed-artifact-integrity-0.0.24.json`, `installed-image-worker-0.0.24.json`,
`upgrade-result-0.0.24.json` and `upgrade-preserved-isolated-data.json`.

The package is unsigned. No signed GitHub Release publication or clean-VM
repair/uninstall lifecycle result is claimed. The local installer and normal
upgrade are verified separately from that remaining lifecycle matrix.

## Installed user stories and recordings

The installed 0.0.24 app was first tested against the original failing 0.0.23
profile. With the native image selected in the copied project, physical clicks
successfully changed English, Dark, Chinese and Light, with each value checked
in the saved settings. The reopened large-image project also displays readable
dark gallery labels. See [the settings result](media/release-0.0.24/physical-light-click-passed.png)
and [dark gallery header](media/release-0.0.24/dark-gallery-header.png).
The project name still contains its original 0.0.23 test label; the executable
used for these checks is the installed and audited 0.0.24 build.

The fresh 0.0.24 tutorial profile completed every material creation entry point,
insertion/management, camera orientation, copying and settings. All 33 official
cases passed their post-action checks: 32 in the installed app and C18 in the
isolated browser fixture. The closed tutorial profile passed its independent
two-project/74-file integrity audit, including source/copy separation.
The main flow starts at an empty launcher, reuses prepared materials, places
three location and three mock-model pictures in the document, arranges the two
props in columns, and opens the actual exported PDF. The focused tutorials
retain a separate video for each workflow.

The seven main chapters completed through the installed UI. The actual export
contains two A4 pages, 1,598 extracted characters and ten images (six/four by
page); section 03 and both prop cards share page two. The exported file matches
the public PDF byte for byte. Both pages were reviewed in Edge and as rasters.
The MP4/GIF remain below one minute. See the [main acceptance](demo-rich-acceptance.md)
and [artifact inventory](media/demo-rich/artifacts.json).

The 0.0.23 baseline already completed 31 native tutorials plus the isolated C18
browser tutorial. W02 exposed the modal-layering defect and its failed takes are
retained. A closed-profile audit passed three projects and 73 hashed files,
including twenty independently copied originals and copy-only text occurring
exactly once. Original-image and manifest integrity checks are independent of
video decoding and visual inspection.

The baseline large-image UI chain also passed using a 300,221,278-byte PNG and a
262,894,203-byte JPEG: **563,115,481 bytes combined**, exceeding 512 MiB. Visible
progress, save/automatic editor close, material reopen, project insertion and
project save/close/reopen were exercised. The six physical fixture/library/
project originals have matching hashes. Driver retries after a successful save
reuse that material and link earlier failure records by hash; no duplicate
import or save is presented as a product recovery result.

Native screenshot Escape cancellation, starting again and in-app cancellation
passed on 0.0.23 with the real Snipping Tool. The draft stayed unchanged and owned
staging cleaned up. Successful capture transfers through the system clipboard
and is excluded from unattended testing. C18 uses an explicit in-memory browser
clipboard/persistence fixture and is never described as Windows integration.

The extra C13 cancellation sequence did **not** pass on 0.0.24: two attempts
timed out waiting for a recognized foreground snipping window. Windows AppModel
events confirm successful ScreenSketch process creation on both attempts, with
the same package as the earlier passing run. The seven capture-related runtime
source files match the 0.0.23 build. Saved evidence cannot distinguish an OS
activation/focus condition, a host-recognition assertion or an application
integration issue; protocol dispatch alone is not proof of a visible overlay.
The owned empty drafts were discarded and their inventory remained unchanged.
No capture region was selected or material saved. Evidence:
`c13-readonly-investigation.md` and `.json` in the final review directory, plus
the retained failed takes under the tutorial work directory. This does not
establish final-build OS Escape/retry success.

One final bounded attempt in the retake profile also failed that prerequisite.
A passive 25-second trace recorded only the visible Preshot window in the
foreground, with no snipping host. The trace reads no window text or clipboard.
The draft was cancelled and cleaned; no further activation was attempted.
See `c13-foreground-final-retake.json`. This reinforces the observed foreground
failure without establishing its underlying OS/application cause.

## Recording-tool verification

The drivers validate the installed executable, process start time, owned profile
and WebView data directory before interacting. Project copying pins the exact
source identity/path. Windows PowerShell 5 reads JSON explicitly as UTF-8;
Chinese-path reads, nine script parsers and fourteen ownership checks pass.

Raw frames and failed takes are preserved. Native app framing includes the full
top toolbar. External Explorer frames carry explicit surface tags; encoding
covers unrelated navigation labels while retaining the address bar and original
files. Uniform lossless intermediate frames avoid a mixed JPEG/PNG concat decode
failure, and FFmpeg now fails on decode errors. Eight framing tests include two
real FFmpeg checks. Five additional file-only regressions cover capture-marker
deletion races, empty markers and error/partial-frame diagnostics.

These corrections affect recording tools, not application runtime. Only exact
case IDs enter default discovery, so archived or failed take directories cannot
be selected accidentally. Media acceptance includes recorded version, source
manifest hashes, complete video decoding and contact-sheet review.

Visual review found a black rectangle during native file-picker closure. The
recorder ignored a failed popup capture and composited its blank bitmap. An
additional 3,544-frame scan identified seven affected takes. The helper now
checks capture success and the popup's current identity, visibility and bounds;
a closing popup triggers a fresh application capture. A still-visible popup
that fails capture remains an explicit error with partial diagnostics. Eight
failing-first PS5/GDI-boundary regressions pass. The affected C02/C03/C04/C05/C12/
C17 tutorials and the main material-creation chapter were re-recorded using this
helper. Original frames and failed encodings are retained; no application
failure is removed or labeled successful by editing a video.

All 33 final tutorial videos fully decode at 1280 x 900 and remain below one
minute. Their recorded version is 0.0.24: 32 native cases and the explicitly
separate C18 browser fixture. See the [tutorial index](../demo/material-tutorials.md)
and [version/hash/contact-sheet inventory](media/release-0.0.24/tutorial-videos.json).
Six retakes use an additional clean profile; their copied recording manifests
match the independent source hashes in `retake-origin.json`. The original
tutorial source/copy projects are unchanged.

The final main MP4 is 57.63 seconds; the GIF is 57.75 seconds with 231 frames.
The actual PDF remains unchanged after re-recording the closing chapter.
Review covered all eleven tutorial contact sheets, full-size key operations,
the main contact sheet and both PDF pages. The seven corrected picker-closing
boundaries were reviewed separately. A final 3,522-frame near-black-rectangle
scan has no candidates; it supplements visual review rather than proving every
possible rendering property. Evidence: `final-media-visual-review.md`,
`retake-picker-boundaries.json` and `final-raw-black-frame-scan.json`.

All owned apps, PDF Guest Edge and Explorer windows were closed before the
read-only profile audits. The original 1024 x 768 display mode was restored.
No real user project/library or live clipboard was used. Final isolated audits:

| Profile under `.preshot-build-cache` | Projects | Hashed files | Result |
| --- | ---: | ---: | --- |
| `material-tutorials-0.0.24/integrity.json` | 2 | 74 | Passed, including independent source/copy contents |
| `material-retakes-0.0.24/integrity.json` | 1 | 14 | Passed |
| `demo-rich-0.0.24/integrity-final.json` | 1 | 24 | Passed; six active materials and one earlier take retained in the recycle bin |

Source, tests, the expanded bundled sample, both README versions, MP4/GIF/PDF
and focused tutorials are included in the Git delivery. Raw recordings,
isolated profiles, large fixtures and MSI build outputs remain outside Git.
The local MSI's checksum/release JSON records the delivery commit after the
final read-only artifact audit. No GitHub Release tag or unsigned asset is
published by this task.

## Remaining limits

- Successful OS screenshot/clipboard transfer still needs manual verification.
- The final installed OS Escape/retry sequence remains unverified after its
  foreground-overlay prerequisite failed; baseline success is recorded separately.
- A destructive install/repair/uninstall/reinstall matrix belongs in a clean VM.
- PDF's bounded following-space hint does not bind an entire tall, indivisible
  gallery to its heading. The complete copied fixture can split that pair across
  pages; expected text and images remain present without observed clipping.
- Unsigned local artifacts are not eligible for signed-release publication.
- A cosmetic English count label still reads "Found 1 materials" for one result;
  the result count and search behavior are correct. This wording is tracked
  separately from the functional corrections above.
