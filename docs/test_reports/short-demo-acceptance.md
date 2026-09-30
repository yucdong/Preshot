# Short installed demo acceptance

[Documentation index](../README.md) · [Recording and reproduction](../demo/README.md)

This report preserves the historical 0.0.12 recording. The shared README media
now belongs to the [0.0.19 recording](demo-0.0.19-acceptance.md); the hashes and
contact sheet below still describe the earlier take.

Recorded on September 29, 2026 using MSI-installed **Preshot 0.0.12**, including
the current logo. This is a focused recording acceptance, not a rerun of the
complete application test matrix.

## Requested flow

The recording starts in an empty project list, creates a genuinely blank
project, writes the shooting plan and reuses materials prepared beforehand.
It shows drag-created columns, a picture group and a checklist, then exports
and opens the same document as PDF. The final chapter creates one additional
material with a picture, description and keywords, saves it and opens its preview.

The encoded MP4 is **57.63 seconds** (2.42 MB); the GIF is **57.75 seconds**
(3.98 MB, 231 frames). Both are below one minute. The edit allocates 57 seconds: project creation 4, writing 6, columns 4,
material reuse 10, picture group 5, checklist 4, prop customization 3,
PDF export 3, PDF reader 6, and material creation/preview 12. File dialogs and
repetitive input are accelerated. There is no switch to a pre-existing project.

## Isolation and provenance

- Normal MSI upgrade to 0.0.12 completed with exit code 0; the installed EXE's
  version is 0.0.12. No application source or installer changes were needed.
- Profile, project files, library and WebView2 storage are beneath
  `.preshot-build-cache/installed-demo-short`. The previous isolated recording
  app was closed before copying its six pictured materials into this new profile.
- Before recording, the startup sample was removed through the project menu
  and its folder archived outside the recording profile's projects folder.
  The launcher and workspace registry were checked to contain no projects.
- All project content in the new take was created through installed UI actions.
  No manifest injection or application IPC was used to author the document.
- Windows UI Automation, posted messages and `PrintWindow` were used after
  Midscene's screen capture again returned an invalid desktop handle. Real user
  projects, the real library and the live clipboard were not used as fixtures.

## Checks

| Check | Evidence |
| --- | --- |
| Empty project list and blank editor at start | Captured before writing; exactly one new project remains registered |
| Prepared materials contain sample images | Six materials across all five categories; seven images; ready previews |
| New document contains authored text and columns | Persisted heading, paragraph, two weighted columns and checklist |
| Library reuse copies pictures into the project | Four pictured artifact cards plus a two-image gallery; project-local files checked |
| PDF corresponds to the new project | Two-page native export; both pages inspected and opened in Edge |
| Closing material creation succeeds | First Save closes the editor; saved pictured material opens in preview |
| Published media stays below one minute | Encoded MP4 and GIF durations checked; see artifact metadata below |
| Presentation | Representative encoded frames and both PDF pages visually reviewed |

## Recording fixes and limits

The empty-document UI Automation range cannot always be scrolled. The helper
now skips that operation for a document with no text. Native file-picker startup
can briefly invalidate its accessibility tree; the bounded detection loop now
retries that COM failure. Failed takes remain archived locally and are rejected
by the renderer. These are recording-helper fixes, not application defects.

The short video intentionally covers the primary creation/reuse/export flow.
It does not repeat screenshot capture, divider resizing, all 22 block types,
DOCX/long-image exports or the full installer lifecycle. Refer to the
[earlier installed acceptance](installed-demo-acceptance.md) for that work and
its explicit limitations. The complete bundled sample remains unchanged.

## Deliverables

- [MP4](../media/preshot-demo.mp4), [GIF](../media/preshot-demo.gif),
  [two-page PDF](../media/preshot-demo.pdf).
- [Artifact metadata and hashes](media/short-demo/artifacts.json).
- [Representative video frames](media/short-demo/contact-sheet.jpg).

Raw takes, screenshots and the isolated editable project remain in the ignored
recording directory. This update does not publish a GitHub release.
