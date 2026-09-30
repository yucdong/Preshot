# Material library and workspace tutorials

[Documentation index](../README.md) · [Main walkthrough](README.md) · [Library guide](../features/material-library.md)

**33 tutorials recorded with Preshot 0.0.24:** 32 use the installed Windows app;
C18 uses the separate browser fixture described below. All videos fully decode,
record the expected version and run for less than one minute, with Chinese and English captions and the
Nanjing bridge portrait example.
Model A is fictional; the model and prop pictures are original illustrations.
See [image credits](photos/credits.json) for the bridge photographs.

## Create each kind of material

| Tutorial | Video |
| --- | --- |
| Single image: name, description, tags and a picture | [C01](../media/material-tutorials/C01.mp4) |
| Image group: import multiple pictures | [C02](../media/material-tutorials/C02.mp4) |
| Location: shooting notes and three bridge photographs | [C03](../media/material-tutorials/C03.mp4) |
| Model: profile fields and three pose illustrations | [C04](../media/material-tutorials/C04.mp4) |
| Props and wardrobe: umbrella notes and picture | [C05](../media/material-tutorials/C05.mp4) |
| Create from the launcher without an open project | [C15](../media/material-tutorials/C15.mp4) |
| Build a new group with pictures from existing materials | [C14](../media/material-tutorials/C14.mp4) |
| Import a camera JPEG, inspect its EXIF orientation and reuse it as an image material | [C19](../media/material-tutorials/C19.mp4) |

## Save document content as materials

| Tutorial | Video |
| --- | --- |
| Save a location card through its menu | [C06](../media/material-tutorials/C06.mp4) |
| Save a model card through its menu | [C07](../media/material-tutorials/C07.mp4) |
| Save a prop card through its menu | [C08](../media/material-tutorials/C08.mp4) |
| Save an entire gallery through its toolbar | [C09](../media/material-tutorials/C09.mp4) |
| Save a selected gallery picture | [C10](../media/material-tutorials/C10.mp4) |
| Save a selected independent Image block | [C11](../media/material-tutorials/C11.mp4) |
| Upload a local file into an Image block | [C12](../media/material-tutorials/C12.mp4) |
| Use a picture tile's save shortcut | [C16](../media/material-tutorials/C16.mp4) |
| Duplicate-name confirmation and discarding a new draft | [C17](../media/material-tutorials/C17.mp4) |

## Insert into a project

| Tutorial | Video |
| --- | --- |
| Place the cursor, insert from the header library and customize a project copy | [I01](../media/material-tutorials/I01.mp4) |
| Insert through the slash menu and paragraph-side plus button | [I02](../media/material-tutorials/I02.mp4) |
| Insert whole or selected galleries as groups or independent images | [I03](../media/material-tutorials/I03.mp4) |
| Append selected gallery pictures and single images to an existing group | [I04](../media/material-tutorials/I04.mp4) |

## Find and manage materials

| Tutorial | Video |
| --- | --- |
| Search names, descriptions and tags; filter and sort | [M01](../media/material-tutorials/M01.mp4) |
| Favorite and unfavorite materials | [M02](../media/material-tutorials/M02.mp4) |
| Edit, save repeatedly, continue editing and discard unsaved changes | [M03](../media/material-tutorials/M03.mp4) |
| Open and close the on-demand full preview | [M04](../media/material-tutorials/M04.mp4) |
| Open original files from details, preview and editing | [M05](../media/material-tutorials/M05.mp4) |
| Delete, cancel deletion and restore from the recycle bin | [M06](../media/material-tutorials/M06.mp4) |
| Permanently delete a recycled snapshot while retaining the project copy | [M07](../media/material-tutorials/M07.mp4) |
| Resize, undo/redo, switch canvas image fit and open the read-only preview | [M08](../media/material-tutorials/M08.mp4) |
| Reorder pictures, delete and restore with undo/redo | [M09](../media/material-tutorials/M09.mp4) |

The 0.0.24 M08 take shows read-only enlarged previews with no crop toolbar.
Frame resizing and crop-to-fill/stretch controls remain in the canvas, with
undo/redo. The installed-app screenshots also verify that a restored image is
immediately selectable after deletion and Undo.

## Project and workspace management

| Tutorial | Video |
| --- | --- |
| Copy a project to a chosen parent folder and name, then edit the independent copy while the original stays open | [W01](../media/material-tutorials/W01.mp4) |
| Switch between Chinese and English, change the theme, then restore the original settings | [W02](../media/material-tutorials/W02.mp4) |

## Clipboard workflow in an isolated test UI

[C18: copy, create an image material by pasting, and paste from preview into a document](../media/material-tutorials/C18.mp4).
This clip uses the production React UI with the existing browser test fixture's
in-memory clipboard and persistence boundary. It uses a real bridge photograph,
but does **not** demonstrate Windows clipboard integration or an MSI session.
No browser clipboard permission is granted and the system clipboard is untouched.

The native screen-capture tutorial C13 is separate from the 33 listed tutorials.
Successful Windows Snipping Tool capture hands its image to the application
through the system clipboard. This unattended run avoids that clipboard. Native
Escape cancellation, starting again and in-app cancellation passed on the
0.0.23 baseline without selecting a region or changing the draft. On 0.0.24,
Windows dispatched Snipping Tool but the foreground-overlay check failed;
native Escape/retry is therefore not a passing final-build result. Owned drafts
were cleaned up. Successful capture still needs manual verification; browser
capture tests use an injected boundary. The acceptance report separates these scopes.

## Recording and acceptance

The recordings use an isolated working directory. Real user projects, library
and clipboard are untouched. Windows UI Automation drives visible controls and
native file pickers; `PrintWindow` records the installed app and its owned
originals folder. No application IPC or database writes are used to enact the
recorded material operations. Each take keeps raw frames, timestamps, errors and
post-action checks outside Git. Failed takes are excluded from published media.

The [main MP4](../media/preshot-demo.mp4) and
[GIF](../media/preshot-demo.gif) remain the concise document-authoring and PDF
export walkthrough. These focused videos complement it.

See the [0.0.24 review](../test_reports/release-0.0.24-review.md)
and [33-video inventory](../test_reports/media/release-0.0.24/tutorial-videos.json)
for results, recorded versions, hashes and decoded-frame contact sheets.
The [earlier acceptance report](../test_reports/material-tutorials-acceptance.md)
retains the previous installed-app evidence, browser coverage and limitations.
Historical reports and raw failed takes are preserved separately.

To reproduce a specific take after preparing its prerequisites in an isolated
profile:

```powershell
$tutorialWork = '.preshot-build-cache/material-tutorials-0.0.24'
powershell -NoProfile -File scripts/record-material-tutorial.ps1 -Case C01 -Work $tutorialWork
python scripts/render-material-tutorials.py --work $tutorialWork --ffmpeg <ffmpeg.exe> --cases C01
python scripts/verify-material-tutorials.py --work $tutorialWork --ffmpeg <ffmpeg.exe> --cases C01 --report-dir docs/test_reports/media/release-0.0.24-C01
```

Use `record-workspace-tutorial.ps1 -Case W01 -Work $tutorialWork` for project
copying, or `-Case W02` for settings. C19 additionally requires the prepared
camera-orientation JPEG in the isolated work directory's `fixtures` folder.
Always pass the versioned work directory explicitly.
Archive a previous take before retrying it. The renderer rejects errors and empty
timelines, speeds file selection, and creates an MP4 and poster for each case.
Pass the complete expected case list to the verifier for release acceptance; a
single-case check does not establish that all 33 tutorials are complete. The
verifier rejects stale versions, failed takes and videos that cannot fully
decode, checks 1280 × 900 output below 60 seconds, and requires a fresh evidence
destination so earlier results remain available.
