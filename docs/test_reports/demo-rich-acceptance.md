# Expanded Nanjing bridge walkthrough acceptance

[Demo and credits](../demo/README.md) · [Editable bundled sample](../../samples/README.md)

The revised walkthrough uses MSI-installed Preshot 0.0.24 with an isolated
profile. The recording starts with an empty project list and a newly created
document. Prepared materials come from UI saves of a separate copy of the
updated bundled sample. Real user data and the system clipboard are untouched.

## Acceptance criteria

- Transparent umbrella and bubble machine occupy the same row in two columns.
- Location contains three distinct credited bridge images. Fictional Model A
  contains three original pose illustrations, clearly described as mock references.
- The document includes a schedule, composition/exposure/action notes, weather
  alternatives, a field checklist and a twelve-picture delivery goal.
- Materials, text and columns are authored through the installed UI. The actual
  PDF export is opened in Edge and reviewed page by page.
- MP4 and GIF remain below one minute with readable bilingual captions.
- The complete offline sample retains every supported block, independent image
  files, two-column props and a separate three-column techniques row.

## Verification

- Release regressions and the installed sample's file/hash checks passed; see
  the [0.0.24 release review](release-0.0.24-review.md) for their separate scope.
- Installed UI: new project creation, typing, five material insertions, native
  two-column drag, PDF export and one additional material creation all completed.
  Authoring, reuse, layout, details, export, PDF review and material creation
  each retain nonempty frames/chapters and an empty errors list.
- Saved document: three distinct location originals, three distinct model
  originals, two props in one two-column row and ten referenced image files.
- Actual exported PDF: two populated A4 pages, 1,598 extracted characters and ten
  image draws (six on page one, four on page two). All image bounds remain inside
  their pages. The props section heading and both side-by-side cards share page
  two. Both pages were opened in Edge and visually reviewed; the rendered pages
  and encoded-video contact sheet were also inspected independently.
- Encoded MP4: 57.63 seconds, 1280 × 900, complete decode passed.
- GIF: 57.75 seconds, 880 × 619, all 231 frames decoded successfully.
- Public MP4, GIF and PDF sizes and SHA-256 hashes match the verification record.
  The public PDF is byte-identical to the application's exported file.
- Documentation and whitespace checks passed after this report update.

[Artifact sizes and SHA-256 hashes](media/demo-rich/artifacts.json) ·
[Video contact sheet](media/demo-rich/contact-sheet.jpg) ·
[PDF page one](media/demo-rich/pdf-page-1.png) ·
[PDF page two](media/demo-rich/pdf-page-2.png)

Run `python scripts/verify-rich-demo.py --work .preshot-build-cache/demo-rich-0.0.24 --ffmpeg <ffmpeg.exe>`
to repeat the project, original-image, PDF and media checks against the retained
recording workspace. The final verification record identifies version 0.0.24;
it does not reuse the earlier recording's media measurements.

The recording helper now handles native folder-picker text fields, empty
WebView2 text ranges, continuous typing and pointer targets covered by the sticky
toolbar. Native file-picker handles also avoid an intermittent invalid UIA tree
while the Windows dialog opens. Failed calibration takes are archived outside Git.
The layout edit ends after the successful drag and omits later zoom calibration.
These recording-helper adjustments are distinct from the application fixes
documented in the release review. No full-screen capture success is claimed.

Raw takes and the isolated profile are under
`.preshot-build-cache/demo-rich-0.0.24`. Prior public media, failed calibration
takes and superseded exports are retained separately from the accepted phases.
Only the final accepted phases contribute to the published media (MP4 57.63
seconds; GIF 57.75 seconds).
The complete offline sample is included in the built and installed 0.0.24 MSI;
its full block inventory is separate from this concise authoring walkthrough.
The final closed profile passed its read-only integrity audit: one project, six
active materials plus the superseded recording material in the recycle bin,
twelve immutable library originals, ten project originals and 24 hashed files,
with no SQLite integrity/foreign-key errors or pending journals. The last
material-creation chapter was re-recorded after fixing a file-picker capture
race; the other six chapters and actual PDF are unchanged. Earlier takes and
the initial 23-file audit are retained.
The final release review records the separate tutorial, signing and installer
lifecycle scopes. Historical 0.0.23 media and evidence remain archived outside
Git; the linked public media and measurements above all identify 0.0.24.
