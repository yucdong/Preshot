# Buglist1 implementation and acceptance

Date: 2026-09-30. Target: 0.0.17, plan v17/document v5, library DB10,
material payload v2 (v1 remains readable). Original user evidence remains in
`test-results/buglist1.md` and its adjacent images. All new test outputs use
`.preshot-build-cache/buglist1-*`; the original evidence was not overwritten.

## Implemented behavior

- JPG/PNG original imports, library writes, batch/draft ownership and native
  material reuse no longer enforce fixed original-byte caps. Streaming copies
  and SHA-256 verification preserve independent image instances and exact receipts.
- Desktop native Image-block uploads use 1 MiB chunks and owned prepare/finish/
  abort receipts. A lost finish response retries the same operation. Cleanup
  errors are surfaced. Clipboard and exported-file limits remain separate.
- Native display derivatives preserve originals and original dimension metadata.
  Decoders serialize raster allocation, use current available memory, cache
  derivatives and support cancellation. A failed import preview preserves the
  original and exposes preview retry. Export derivatives use frame/crop/output size.
- Material details provide version-checked favorite/unfavorite actions, a busy
  guard and list/filter refresh.
- Location, prop and legacy clothing cards support vertical/horizontal regions,
  swapped order, adjustable share/minimum height and narrow-width stacking.
  Model cards retain their previous layout.
- Native Image blocks have eight resize zones, proportional corners,
  single-axis edges, cover/stretch, Escape cancellation and one undo per drag.
  Ctrl+Z/Ctrl+Y work with the frame focused. Galleries retain the same directions.
- The insertion menu uses viewport coordinates, constrained scrolling, refresh
  on scrolling/resizing and scroll padding for fractional DPI/zoom positions.

## Regressions and visual review

| User story | Evidence/result |
| --- | --- |
| Reach the final insert option at the document bottom | 10 browser scenarios passed: Chinese/English, keyboard, 420–900px height, 70–180% canvas zoom |
| Scroll/resize an open menu at 100/150/200% pixel scale | 3 browser DPR scenarios passed; wheel, scrollbar and keyboard reach final options |
| Change card layout, save a material and insert it again | Browser real-editor/material-port integration passed with long Chinese text and a picture |
| Favorite a material and update the current favorite filter | Browser integration and metadata CAS regressions passed |
| Resize a native image, undo, cancel a corner drag and change fit | Browser integration passed with all eight zones |
| Keep crop/stretch pixels and card regions in exports | Real PDF, DOCX and PNG exporters passed; PDF raster review and Microsoft Word DOCX-to-PDF review performed |
| Preserve pasted image pixels in long exports | JPEG and PNG pixel tests passed, including captions, alignment and no plan mutation |
| Stream originals and recover a lost response | Adapter regression passed for bounded chunks, offsets, same-receipt retry and cleanup failure |
| Insert old material payloads into new documents | Native regression covers image groups, location, model, props and legacy clothing |
| Save/reinsert a resized native image without replacing its original | Native cover-crop snapshot/insertion regression passed |
| Preserve migration transactions and historical receipts | DB10 rollback, foreign-key, immutable-instance and old-receipt regressions passed |
| Cancel card-height adjustment or receive a concurrent card edit | Four new regressions first failed, then passed; Escape, pointer cancellation and blur discard previews; a completed drag commits once |

Visual review found and fixed additional issues: native frame-focused undo,
React image node views not yet mounted when export readiness ran, selection
outlines in long-image output, native PDF alignment and a second image-scale
application inside DOCX card regions. Export archives and review rasters are in
`.preshot-build-cache/buglist1-docx-scale`.

Reviewed output: [PDF raster](media/buglist1/pdf.png),
[Microsoft Word DOCX raster](media/buglist1/docx.png), and
[long image](media/buglist1/long-image.png). The color-strip fixture makes
cover cropping (green square) distinguishable from stretch (all three colors).
Typography and card decoration follow each exporter's existing presentation.

### Automated validation

- Complete native suite: **368 passed, 0 failed, 7 ignored**. The opt-in real
  large-original scenario was then run separately and passed.
- Complete Vitest run: **1588 passed, 1 failed**. The failure was a stale
  preview-cache version expectation; after updating it, the entire affected
  `tauriMaterialLibrary.test.ts` suite passed. This is a full run plus a focused
  correction, not a second complete all-green run.
- Later focused runs: material provider/favorite conflict and busy protection
  **55 passed**; card-height/card rendering **11 passed**; PDF mappings
  **16 passed**; DOCX/package regressions **20 passed**; streamed upload
  regressions **11 passed**.
- Browser integration: presentation/menu **12 passed**, pasted-image export
  pixels **2 passed**, and the three DPR menu scenarios plus production-export
  scenario **4 passed**. The export scenario also passed after the DOCX scale fix.
- TypeScript, lint, i18n (852 messages), documentation, initializer and
  production-script checks passed. Lint retains two non-blocking fast-refresh
  warnings in the custom image block factory; the native build reports one
  unused legacy helper. Bundle-size warnings remain informational.

## Large originals

`scripts/generate-large-image-fixtures.py` creates actual decodable entropy
rasters, not padded files:

| Original | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- |
| PNG | 10000 × 10000 | 300221278 | `1d7a0cdfddddda032c5253bf739bd3a35a11d09be10d9ab264f42df06ac5cd82` |
| JPEG | 8000 × 8000 | 262894203 | `20d501343a8db5084cde6c147012cca2d2445c8fbd4fa18bd2ae90eaa16f28ac` |

The native scenario uses PNG + PNG + JPEG (863336759 bytes), covering creation,
save/reopen, native material-to-draft copying, independent identities, project
insertion, project display, export derivatives and original hash equality.
Its final run and working-set samples are recorded separately in
`buglist1-large-native-final.log` and `buglist1-large-memory.csv`.
The complete native scenario passed in 837.08 seconds in an unoptimized test
build. Its 415 working-set samples peaked at 636760064 bytes; the process-reported
peak was 637349888 bytes (about 608 MiB), while independently owned original
copies accumulated across draft, library and project storage. These numbers
measure the native test process, not an installed renderer. They are not a
guarantee of decoding arbitrary images on machines with less available memory.

## MSI and remaining acceptance

Final artifact:
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Preshot_0.0.17_x64_en-US.msi`
(26431488 bytes). SHA-256:
`62ca138579788aad46feed0efdbde11ddfb785920ee47f5adf9f07d24eb36bfb`.

The compiled MSI's metadata and runtime contracts passed the production artifact
checker using a byte-identical isolated verification copy. Upgrade from the
intermediate 0.0.16 installation returned Windows Installer exit code **0**.
The installed executable matches the final build byte for byte except for the
three-byte Tauri bundle marker (`UNK` becomes `MSI` during packaging), which was
checked explicitly. The developer's debug application was not stopped.
The installed 0.0.17 worker processed the same 300221278-byte original in
**3.40 seconds**, producing a 2048px PNG derivative (12222723 bytes), exit code
**0**, with unchanged original SHA-256. Evidence is in
`buglist1-upgrade-0.0.17.log` and
`buglist1-installed/final-package-result.json` under `.preshot-build-cache`.

The intermediate 0.0.16 x64 MSI was built and installed successfully (Windows Installer exit
code 0). The installed application starts with an isolated USERPROFILE and
WebView data directory under `.preshot-build-cache/buglist1-installed`.
Its real installed image worker successfully decoded the 300221278-byte PNG to
a 2048px derivative; the source SHA-256 remained unchanged.

**Installed interactive/visual acceptance is pending.** The installed WebView did
not expose the requested CDP port, and Midscene desktop connection failed its
screenshot health check with Windows `CopyFromScreen: The handle is invalid`.
The user was asked to restore an unlocked desktop session. Browser DPR coverage
is not presented as a completed Windows display-scale matrix. No destructive
uninstall matrix was run and no developer project/library was used.
The desktop health check failed again after the final build. The computer
automation workflow explicitly requires both screenshot and pointer health
checks to pass before further desktop operations; no UI actions were attempted
after that failure.

Disk-full, process-interruption and failed publication are covered by transaction
and write-failure regressions; this run did not fill the physical system disk.
Actual codec/system-memory limits still apply to decoding, independently of
original encoded file size. The installer is a local acceptance build; publishing
still requires the repository's signing/release checks.
