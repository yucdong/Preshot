# Preshot 0.0.19 installed demo acceptance

[Documentation index](../README.md) · [Recording guide and credits](../demo/README.md)

Recorded on September 30, 2026 with **MSI-installed Preshot 0.0.19**. The new
README video and GIF start with an empty project list and show the document
creation workflow. They replace the 0.0.12 recording at the same media URLs.

The MP4 is **57.71 seconds**, 1280 by 900 pixels, 2.45 MB. The GIF is
**57.75 seconds**, 880 by 619 pixels, 231 frames, 4.28 MB. Both contain
Chinese/English chapter captions. File selection and repeated input are
accelerated; the actual exported PDF is opened in Edge and both pages are shown.

## Recorded story

The photographer begins a new Nanjing bridge portrait project, writes the
concept and schedule, and drags a text block beside another to create two
columns. Prepared materials supply the location, fictional Model A, transparent
umbrella, bubble machine and bridge reference gallery, all with pictures.
The photographer adds an execution checklist, customizes prop names, exports
the plan to PDF and reviews both pages. The final chapter creates an additional
umbrella material with a picture, description and four searchable tags, saves
it, and opens its committed preview.

The 57-second planned edit allocates 4 seconds to creation, 6 to writing, 4 to
columns, 10 to material reuse, 5 to the gallery, 4 to the checklist, 3 to prop
customization, 3 to export, 6 to the PDF reader, and 12 to material creation and
preview. Encoding adds less than one second.

## Isolation and provenance

- The local 0.0.19 MSI upgrade completed successfully with exit code 0. The
  executable at `C:\Program Files\Preshot\preshot.exe` reports 0.0.19. Its bytes
  match the release build after Tauri's expected `UNK` to `MSI` bundle marker
  replacement. Installer and executable hashes are recorded below.
- The recording uses `.preshot-build-cache/demo-0.0.19` for its isolated profile,
  projects, library and WebView2 storage. Six pictured materials were prepared
  from an earlier isolated demo library using a read-only SQLite backup and
  separate asset copies before starting the destination app.
- The isolated work path was confirmed in the first-launch dialog. Before
  recording, the startup sample was removed through the project menu and its
  directory archived outside the profile's projects folder. The launcher was
  checked to contain no projects. Exactly one newly authored project remains.
- Every recorded document edit, insertion, export and material save was made
  through the installed UI. No application IPC, manifest injection or browser
  adapter authored the document. Saved files were inspected read-only afterward.
- Midscene desktop connection, screenshot and mouse health checks passed.
  Existing Windows UI Automation, posted-message and `PrintWindow` helpers
  performed the deterministic capture. OS and browser chrome are cropped from
  the published media. Real user projects, library and clipboard were not used.

## Verification

| Check | Result |
| --- | --- |
| Empty workspace and blank project | Captured at the start; one project registered afterward |
| Prepared material pictures | Location, model, two props and gallery used; six original files copied into the project |
| Text and columns | Saved heading, concept, schedule, one column list with two columns, and checklist verified |
| Saved component content | Four artifacts and one two-image group verified in the new manifest |
| Exported document | Two PDF pages and six embedded pictures; title, schedule and all pictured cards verified |
| Actual PDF viewing | Reader URL and page number checked; both pages captured and visually inspected |
| New material | One new material with one picture, description and four tags persisted; first Save closed its editor; preview opened |
| Recording integrity | All seven capture phases contain frames and report no errors |
| Video playback | Entire MP4 decoded without errors; encoded duration is below one minute |
| GIF and presentation | All GIF frames decoded; duration checked; representative encoded frames and captions inspected |

No application failure was observed in this recording flow. The installed-demo
launcher was updated to use the current Program Files location and to accept
`PRESHOT_DEMO_EXECUTABLE` for a custom install path. No product changes were
needed for this recording.

This is focused walkthrough verification. It does not repeat the full installer
lifecycle, every block type, screenshot capture, divider resizing, DOCX or
long-image export. The separate complete bundled sample remains unchanged.

## Deliverables

- [Captioned MP4](../media/preshot-demo.mp4)
- [README GIF](../media/preshot-demo.gif)
- [Actual two-page export](../media/preshot-demo.pdf)
- [Artifact metadata and hashes](media/demo-0.0.19/artifacts.json)
- [Representative encoded frames](media/demo-0.0.19/contact-sheet.jpg)

`pnpm docs:check` and focused ESLint validation of the updated launcher passed.
Raw recordings, phase logs, the previous published media backup and the editable
new project remain in the ignored recording directory. Historical reports and
their original contact sheets and hashes are retained separately.
